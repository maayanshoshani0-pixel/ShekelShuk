const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MARKETS_FILE = path.join(DATA_DIR, "markets.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const ADMIN_EMAIL = "maayansho2010@gmail.com";
const STARTING_CREDITS = 1000;
const SESSION_COOKIE = "shekelshuk_session";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_FILE)) {
    writeJson(USERS_FILE, []);
  }

  if (!fs.existsSync(SESSIONS_FILE)) {
    writeJson(SESSIONS_FILE, []);
  }

  if (!fs.existsSync(MARKETS_FILE)) {
    writeJson(MARKETS_FILE, [
      {
        id: "pep-rally-start",
        title: "Will the pep rally begin before 2:15 PM?",
        category: "Pep Rally",
        status: "Closes in 2h",
        yesPrice: 63,
        noPrice: 37,
        volume: 2140,
        description: "A same-day campus event market with a clear yes-or-no outcome."
      },
      {
        id: "attendance-week",
        title: "Will 10th grade top this week's attendance leaderboard?",
        category: "Attendance",
        status: "Closes tomorrow",
        yesPrice: 59,
        noPrice: 41,
        volume: 890,
        description: "A school-wide standings market tied to actual attendance results."
      },
      {
        id: "lunch-vote",
        title: "Will the new lunch seating proposal pass this month?",
        category: "Council Vote",
        status: "New",
        yesPrice: 82,
        noPrice: 18,
        volume: 1320,
        description: "A community governance market focused on a student council proposal."
      }
    ]);
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  });
  response.end(text);
}

function serveFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(filePath).pipe(response);
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return header.split(";").reduce((cookies, item) => {
    const trimmed = item.trim();
    if (!trimmed) {
      return cookies;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return cookies;
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function createSession(userId) {
  const sessions = readJson(SESSIONS_FILE, []);
  const token = crypto.randomBytes(24).toString("hex");
  const session = {
    token,
    userId,
    createdAt: new Date().toISOString()
  };
  sessions.push(session);
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

function destroySession(token) {
  const sessions = readJson(SESSIONS_FILE, []);
  const nextSessions = sessions.filter((session) => session.token !== token);
  writeJson(SESSIONS_FILE, nextSessions);
}

function getCurrentUser(request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const sessions = readJson(SESSIONS_FILE, []);
  const session = sessions.find((entry) => entry.token === token);
  if (!session) {
    return null;
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find((entry) => entry.id === session.userId);
  return user || null;
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    grade: user.grade,
    credits: user.credits,
    role: user.role,
    createdAt: user.createdAt
  };
}

function buildStats() {
  const users = readJson(USERS_FILE, []);
  const markets = readJson(MARKETS_FILE, []);
  const credits = users.reduce((sum, user) => sum + Number(user.credits || 0), 0);
  return {
    creditsInCirculation: credits,
    activeMarkets: markets.length,
    players: users.length,
    casinoGames: 0
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/stats") {
    sendJson(response, 200, { stats: buildStats() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/markets") {
    sendJson(response, 200, { markets: readJson(MARKETS_FILE, []) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    const user = getCurrentUser(request);
    sendJson(response, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signup") {
    const body = await parseBody(request);
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const grade = String(body.grade || "").trim();

    if (!fullName || !email || !password || !confirmPassword || !grade) {
      sendJson(response, 400, { error: "All fields are required." });
      return;
    }

    if (!validateEmail(email)) {
      sendJson(response, 400, { error: "Enter a valid email address." });
      return;
    }

    if (password.length < 6) {
      sendJson(response, 400, { error: "Password must be at least 6 characters." });
      return;
    }

    if (password !== confirmPassword) {
      sendJson(response, 400, { error: "Passwords do not match." });
      return;
    }

    const users = readJson(USERS_FILE, []);
    if (users.some((user) => user.email === email)) {
      sendJson(response, 409, { error: "An account with that email already exists." });
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      fullName,
      email,
      passwordHash: hashPassword(password),
      grade,
      credits: STARTING_CREDITS,
      role: email === ADMIN_EMAIL ? "admin" : "member",
      createdAt: new Date().toISOString()
    };

    users.push(user);
    writeJson(USERS_FILE, users);

    const token = createSession(user.id);
    sendJson(response, 201, {
      user: publicUser(user),
      message: user.role === "admin" ? "Admin account created." : "Account created."
    }, {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await parseBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const users = readJson(USERS_FILE, []);
    const user = users.find((entry) => entry.email === email);

    if (!user || user.passwordHash !== hashPassword(password)) {
      sendJson(response, 401, { error: "Incorrect email or password." });
      return;
    }

    const token = createSession(user.id);
    sendJson(response, 200, {
      user: publicUser(user),
      message: user.role === "admin" ? "Admin login successful." : "Login successful."
    }, {
      "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    const cookies = parseCookies(request);
    if (cookies[SESSION_COOKIE]) {
      destroySession(cookies[SESSION_COOKIE]);
    }

    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
    });
    return;
  }

  sendJson(response, 404, { error: "Endpoint not found." });
}

const server = http.createServer(async (request, response) => {
  ensureDataFiles();

  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      serveFile(response, path.join(ROOT, "index.html"));
      return;
    }

    if (url.pathname === "/register" || url.pathname === "/register.html") {
      serveFile(response, path.join(ROOT, "register.html"));
      return;
    }

    const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    serveFile(response, path.join(ROOT, safePath));
  } catch (error) {
    sendJson(response, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  ensureDataFiles();
  console.log(`ShekelShuk server listening on http://${HOST}:${PORT}`);
});
