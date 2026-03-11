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

// Signed GET for /api/v3/account
async function mexcSignedGet(path, params = {}) {
  if (!MEXC_ACCESS_KEY ||
