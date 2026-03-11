import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

const {
  MCP_TOKEN,
  MEXC_ACCESS_KEY,
  MEXC_SECRET_KEY,
  MEXC_BASE_URL = "https://api.mexc.com",
  PORT = 3000
} = process.env;

function requireAuth(req, res) {
  const auth = req.header("authorization") || "";
  const tokenFromBearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;

  const tokenFromHeader = req.header("x-mcp-token");
  const token = tokenFromBearer || tokenFromHeader;

  if (!MCP_TOKEN || token !== MCP_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function hmacSha256Hex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function mexcPublicGet(path, params = {}) {
  const url = new URL(path, MEXC_BASE_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });

  const r = await fetch(url.toString());
  const text = await r.text();
  if (!r.ok) throw new Error(`MEXC ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function mexcSignedGet(path, params = {}) {
  if (!MEXC_ACCESS_KEY || !MEXC_SECRET_KEY) {
    throw new Error("Missing MEXC_ACCESS_KEY or MEXC_SECRET_KEY");
  }

  const timestamp = Date.now();
  const recvWindow = params.recvWindow ?? 5000;

  const search = new URLSearchParams();
  search.set("timestamp", String(timestamp));
  search.set("recvWindow", String(recvWindow));

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === "timestamp" || k === "recvWindow") continue;
    search.set(k, String(v));
  }

  const queryString = search.toString();
  const signature = hmacSha256Hex(MEXC_SECRET_KEY, queryString);

  const url = new URL(path, MEXC_BASE_URL);
  url.search = `${queryString}&signature=${signature}`;

  const r = await fetch(url.toString(), {
    headers: { "X-MEXC-APIKEY": MEXC_ACCESS_KEY }
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`MEXC ${r.status}: ${text}`);
  return JSON.parse(text);
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// SSE (Notion MCP connector often probes an SSE endpoint)
function sseHandler(req, res) {
  if (!requireAuth(req, res)) return;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`event: ready\ndata: {}\n\n`);

  const interval = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 25000);

  req.on("close", () => clearInterval(interval));
}

app.get("/sse", sseHandler);
app.get("/mcp/sse", sseHandler);
app.get("/mcp", sseHandler);

// Tools list
app.get("/tools", (req, res) => {
  if (!requireAuth(req, res)) return;

  res.json({
    tools: [
      {
        name: "getTicker24hr",
        description: "Fetch MEXC spot 24h stats (all symbols or one symbol).",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Optional, e.g. BTCUSDT" }
          }
        }
      },
      {
        name: "getAccount",
        description: "Fetch MEXC account balances (SIGNED).",
        inputSchema: {
          type: "object",
          properties: {
            recvWindow: { type: "number", description: "Optional, default 5000" }
          }
        }
      }
    ]
  });
});

// Tools call
app.post("/tools/call", async (req, res) => {
  if (!requireAuth(req, res)) return;

  try {
    const { name, input } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "Missing tool name" });

    if (name === "getTicker24hr") {
      const data = await mexcPublicGet("/api/v3/ticker/24hr", { symbol: input?.symbol });
      return res.json({ result: data });
    }

    if (name === "getAccount") {
      const data = await mexcSignedGet("/api/v3/account", { recvWindow: input?.recvWindow });
      return res.json({ result: data });
    }

    return res.status(404).json({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
});

app.listen(PORT, () => {
  console.log(`MEXC MCP server listening on port ${PORT}`);
});

