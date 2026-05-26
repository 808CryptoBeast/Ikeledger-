import http from "node:http";

const PORT = Number(process.env.PORT || 8788);
const CACHE_MS = Number(process.env.CACHE_MS || 60_000);
const IMAGE_CACHE_MS = Number(process.env.IMAGE_CACHE_MS || 6 * 60 * 60 * 1000);
const ALLOWED_HOSTS = new Set([
  "api.xrpl.to",
  "www.xrpl.to",
  "api.coingecko.com",
  "ipfs.io",
  "arweave.net",
  "ipfs.firstledger.net"
]);

const cache = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function getSafeTarget(url) {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || !ALLOWED_HOSTS.has(target.hostname)) {
    throw new Error("Target host is not allowed.");
  }
  return target;
}

async function getCached(key, ttl, loader) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < ttl) {
    return { ...cached, cacheHit: true };
  }
  const loaded = await loader();
  cache.set(key, { ...loaded, createdAt: Date.now() });
  return { ...loaded, cacheHit: false };
}

async function proxyJson(target) {
  return getCached(`json:${target.href}`, CACHE_MS, async () => {
    const upstream = await fetchWithTimeout(target, {
      headers: {
        accept: "application/json",
        "user-agent": "IkeLedger market proxy"
      }
    });
    const body = await upstream.text();
    if (!upstream.ok) {
      const error = new Error(`Upstream failed (${upstream.status})`);
      error.status = upstream.status;
      error.body = body;
      throw error;
    }
    return {
      body,
      contentType: upstream.headers.get("content-type") || "application/json"
    };
  });
}

async function proxyImage(target) {
  return getCached(`image:${target.href}`, IMAGE_CACHE_MS, async () => {
    const upstream = await fetchWithTimeout(target, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*",
        "user-agent": "Mozilla/5.0 IkeLedger image proxy"
      }
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok) {
      const error = new Error(`Upstream image failed (${upstream.status})`);
      error.status = upstream.status;
      throw error;
    }
    return {
      body,
      contentType: upstream.headers.get("content-type") || "application/octet-stream"
    };
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== "/market" && requestUrl.pathname !== "/image") {
      send(res, 404, JSON.stringify({ error: "Not found" }), { "Content-Type": "application/json" });
      return;
    }

    const rawTarget = requestUrl.searchParams.get("url");
    if (!rawTarget) {
      send(res, 400, JSON.stringify({ error: "Missing url parameter" }), { "Content-Type": "application/json" });
      return;
    }

    const target = getSafeTarget(rawTarget);
    if (requestUrl.pathname === "/market") {
      const result = await proxyJson(target);
      send(res, 200, result.body, {
        "Content-Type": result.contentType,
        "X-IkeLedger-Cache": result.cacheHit ? "hit" : "miss"
      });
      return;
    }

    const result = await proxyImage(target);
    send(res, 200, result.body, {
      "Content-Type": result.contentType,
      "Cache-Control": "public, max-age=21600",
      "X-IkeLedger-Cache": result.cacheHit ? "hit" : "miss"
    });
  } catch (error) {
    const status = error.name === "AbortError" ? 504 : Number(error.status || 500);
    send(res, status, JSON.stringify({ error: error.message || "Proxy error" }), {
      "Content-Type": "application/json"
    });
  }
});

server.listen(PORT, () => {
  console.log(`IkeLedger market proxy listening on http://127.0.0.1:${PORT}`);
});
