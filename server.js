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
const BETS_FILE = path.join(DATA_DIR, "bets.json");
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

  if (!fs.existsSync(BETS_FILE)) {
    writeJson(BETS_FILE, []);
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
        description: "A same-day campus event market with a clear yes-or-no outcome.",
        resolved: false,
        outcome: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "attendance-week",
        title: "Will 10th grade top this week's attendance leaderboard?",
        category: "Attendance",
        status: "Closes tomorrow",
        yesPrice: 59,
        noPrice: 41,
        volume: 890,
        description: "A school-wide standings market tied to actual attendance results.",
        resolved: false,
        outcome: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "lunch-vote",
        title: "Will the new lunch seating proposal pass this month?",
        category: "Council Vote",
        status: "New",
        yesPrice: 82,
        noPrice: 18,
        volume: 1320,
        description: "A community governance market focused on a student council proposal.",
        resolved: false,
        outcome: null,
        createdAt: new Date().toISOString()
      }
    ]);
  }
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
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
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

    cookies[trimmed.slice(0, separatorIndex)] = decodeURIComponent(trimmed.slice(separatorIndex + 1));
    return cookies;
  }, {});
}

function createSession(userId) {
  const sessions = readJson(SESSIONS_FILE, []);
  const token = crypto.randomBytes(24).toString("hex");
  sessions.push({
    token,
    userId,
    createdAt: new Date().toISOString()
  });
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

function destroySession(token) {
  const sessions = readJson(SESSIONS_FILE, []);
  writeJson(SESSIONS_FILE, sessions.filter((session) => session.token !== token));
}

function getCurrentUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const sessions = readJson(SESSIONS_FILE, []);
  const session = sessions.find((entry) => entry.token === token);
  if (!session) {
    return null;
  }

  const users = readJson(USERS_FILE, []);
  return users.find((entry) => entry.id === session.userId) || null;
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

function normalizeCredential(value) {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStudentId(value) {
  return /^[a-z0-9._-]{3,32}$/i.test(value);
}

function validateCredential(value) {
  return isEmail(value) || isStudentId(value);
}

function buildStats() {
  const users = readJson(USERS_FILE, []);
  const markets = readJson(MARKETS_FILE, []);
  const bets = readJson(BETS_FILE, []);
  const availableCredits = users.reduce((sum, user) => sum + Number(user.credits || 0), 0);
  const activeStakes = bets.filter((bet) => !bet.resolved).reduce((sum, bet) => sum + Number(bet.amount || 0), 0);

  return {
    creditsInCirculation: availableCredits + activeStakes,
    activeMarkets: markets.filter((market) => !market.resolved).length,
    players: users.length,
    casinoGames: 0
  };
}

function serializeMarket(market) {
  return {
    id: market.id,
    title: market.title,
    category: market.category,
    status: market.status,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    volume: market.volume,
    description: market.description,
    resolved: Boolean(market.resolved),
    outcome: market.outcome || null,
    createdAt: market.createdAt
  };
}

function serializeBet(bet, markets) {
  const market = markets.find((entry) => entry.id === bet.marketId);
  return {
    id: bet.id,
    marketId: bet.marketId,
    marketTitle: market ? market.title : "Unknown market",
    side: bet.side,
    amount: bet.amount,
    resolved: Boolean(bet.resolved),
    won: Boolean(bet.won),
    payout: Number(bet.payout || 0),
    createdAt: bet.createdAt
  };
}

function requireAuth(request, response) {
  const user = getCurrentUser(request);
  if (!user) {
    sendJson(response, 401, { error: "You need to log in first." });
    return null;
  }
  return user;
}

function requireAdmin(request, response) {
  const user = requireAuth(request, response);
  if (!user) {
    return null;
  }
  if (user.role !== "admin") {
    sendJson(response, 403, { error: "Admin access required." });
    return null;
  }
  return user;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/stats") {
    sendJson(response, 200, { stats: buildStats() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/markets") {
    sendJson(response, 200, { markets: readJson(MARKETS_FILE, []).map(serializeMarket) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    const user = getCurrentUser(request);
    sendJson(response, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/me/bets") {
    const user = requireAuth(request, response);
    if (!user) {
      return;
    }

    const markets = readJson(MARKETS_FILE, []);
    const bets = readJson(BETS_FILE, []).filter((bet) => bet.userId === user.id).map((bet) => serializeBet(bet, markets));
    sendJson(response, 200, { bets });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/signup") {
    const body = await parseBody(request);
    const fullName = String(body.fullName || "").trim();
    const email = normalizeCredential(body.email);
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || "");
    const grade = String(body.grade || "").trim();

    if (!fullName || !email || !password || !confirmPassword || !grade) {
      sendJson(response, 400, { error: "All fields are required." });
      return;
    }

    if (!validateCredential(email)) {
      sendJson(response, 400, { error: "Enter a valid email address or student ID." });
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
      role: users.length === 0 ? "admin" : "member",
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
    const email = normalizeCredential(body.email);
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

  if (request.method === "POST" && url.pathname === "/api/bets") {
    const user = requireAuth(request, response);
    if (!user) {
      return;
    }

    const body = await parseBody(request);
    const marketId = String(body.marketId || "").trim();
    const side = String(body.side || "").trim().toUpperCase();
    const amount = Number(body.amount || 0);

    if (!marketId || !["YES", "NO"].includes(side) || !Number.isFinite(amount) || amount <= 0) {
      sendJson(response, 400, { error: "Enter a valid market, side, and amount." });
      return;
    }

    const users = readJson(USERS_FILE, []);
    const markets = readJson(MARKETS_FILE, []);
    const bets = readJson(BETS_FILE, []);
    const freshUser = users.find((entry) => entry.id === user.id);
    const market = markets.find((entry) => entry.id === marketId);

    if (!freshUser) {
      sendJson(response, 404, { error: "User not found." });
      return;
    }

    if (!market || market.resolved) {
      sendJson(response, 400, { error: "That market is not open for betting." });
      return;
    }

    if (freshUser.credits < amount) {
      sendJson(response, 400, { error: "Not enough credits for that bet." });
      return;
    }

    freshUser.credits -= amount;
    market.volume = Number(market.volume || 0) + amount;
    bets.push({
      id: crypto.randomUUID(),
      userId: freshUser.id,
      marketId,
      side,
      amount,
      resolved: false,
      won: false,
      payout: 0,
      createdAt: new Date().toISOString()
    });

    writeJson(USERS_FILE, users);
    writeJson(MARKETS_FILE, markets);
    writeJson(BETS_FILE, bets);

    sendJson(response, 201, {
      message: "Bet placed.",
      user: publicUser(freshUser),
      market: serializeMarket(market)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/markets") {
    const admin = requireAdmin(request, response);
    if (!admin) {
      return;
    }

    const body = await parseBody(request);
    const title = String(body.title || "").trim();
    const category = String(body.category || "").trim();
    const description = String(body.description || "").trim();
    const status = String(body.status || "Open").trim();
    const yesPrice = Number(body.yesPrice || 50);
    const noPrice = Number(body.noPrice || 50);

    if (!title || !category || !description) {
      sendJson(response, 400, { error: "Title, category, and description are required." });
      return;
    }

    const markets = readJson(MARKETS_FILE, []);
    const market = {
      id: crypto.randomUUID(),
      title,
      category,
      description,
      status,
      yesPrice,
      noPrice,
      volume: 0,
      resolved: false,
      outcome: null,
      createdAt: new Date().toISOString()
    };

    markets.unshift(market);
    writeJson(MARKETS_FILE, markets);
    sendJson(response, 201, { market: serializeMarket(market), message: "Market created." });
    return;
  }

  if (request.method === "POST" && /^\/api\/admin\/markets\/[^/]+\/resolve$/.test(url.pathname)) {
    const admin = requireAdmin(request, response);
    if (!admin) {
      return;
    }

    const marketId = url.pathname.split("/")[4];
    const body = await parseBody(request);
    const outcome = String(body.outcome || "").trim().toUpperCase();

    if (!["YES", "NO"].includes(outcome)) {
      sendJson(response, 400, { error: "Outcome must be YES or NO." });
      return;
    }

    const markets = readJson(MARKETS_FILE, []);
    const bets = readJson(BETS_FILE, []);
    const users = readJson(USERS_FILE, []);
    const market = markets.find((entry) => entry.id === marketId);

    if (!market) {
      sendJson(response, 404, { error: "Market not found." });
      return;
    }

    if (market.resolved) {
      sendJson(response, 400, { error: "This market has already been resolved." });
      return;
    }

    market.resolved = true;
    market.outcome = outcome;
    market.status = `Resolved ${outcome}`;

    bets.forEach((bet) => {
      if (bet.marketId !== marketId || bet.resolved) {
        return;
      }

      bet.resolved = true;
      bet.won = bet.side === outcome;
      bet.payout = bet.won ? bet.amount * 2 : 0;

      if (bet.won) {
        const winningUser = users.find((entry) => entry.id === bet.userId);
        if (winningUser) {
          winningUser.credits += bet.payout;
        }
      }
    });

    writeJson(MARKETS_FILE, markets);
    writeJson(BETS_FILE, bets);
    writeJson(USERS_FILE, users);

    sendJson(response, 200, { market: serializeMarket(market), message: `Market resolved ${outcome}.` });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    const token = parseCookies(request)[SESSION_COOKIE];
    if (token) {
      destroySession(token);
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

    if (url.pathname === "/dashboard" || url.pathname === "/dashboard.html") {
      serveFile(response, path.join(ROOT, "dashboard.html"));
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
