import http from "node:http";

const PORT = Number(process.env.PORT || 8788);
const CACHE_MS = Number(process.env.CACHE_MS || 60_000);
const IMAGE_CACHE_MS = Number(process.env.IMAGE_CACHE_MS || 6 * 60 * 60 * 1000);
const DEX_HISTORY_CACHE_MS = Number(process.env.DEX_HISTORY_CACHE_MS || 10 * 60 * 1000);
const DEX_HISTORY_MAX_PAGES = Number(process.env.DEX_HISTORY_MAX_PAGES || 60);
const DEX_HISTORY_PAGE_LIMIT = 100;
const XRPL_WS_ENDPOINTS = {
  "xrpl-mainnet": "wss://s1.ripple.com",
  "xrpl-testnet": "wss://s.altnet.rippletest.net:51233"
};
const ALLOWED_HOSTS = new Set([
  "api.xrpl.to",
  "www.xrpl.to",
  "api.xrpscan.com",
  "api.coingecko.com",
  "api.kraken.com",
  "api.sologenic.org",
  "ipfs.io",
  "arweave.net",
  "ipfs.firstledger.net"
]);

const cache = new Map();
let nextWsId = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function isValidXrplAddress(value = "") {
  return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(String(value));
}

function normalizeCurrency(value = "") {
  return String(value || "").trim();
}

function decodeCurrencyCode(currency = "") {
  const value = String(currency || "").trim();
  if (/^[A-Fa-f0-9]{40}$/.test(value)) {
    try {
      return value.match(/.{2}/g)
        .map((pair) => Number.parseInt(pair, 16))
        .filter((code) => code > 0)
        .map((code) => String.fromCharCode(code))
        .join("")
        .replace(/[^\x20-\x7E]/g, "")
        .trim();
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeTimestamp(value) {
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const n = Number(value) || 0;
  if (!n) return 0;
  return n > 1e12 ? n : n * 1000;
}

function amountValue(amount) {
  if (typeof amount === "string") {
    const drops = Number(amount);
    return Number.isFinite(drops) ? drops / 1_000_000 : Number.NaN;
  }
  if (amount && typeof amount === "object") {
    const value = Number(amount.value);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  return Number.NaN;
}

function amountIsXrp(amount) {
  return typeof amount === "string";
}

function amountMatchesToken(amount, currency, issuer) {
  if (!amount || typeof amount !== "object") return false;
  const assetCurrency = normalizeCurrency(amount.currency);
  const tokenCurrency = normalizeCurrency(currency);
  return String(amount.issuer || "") === issuer
    && (assetCurrency === tokenCurrency || decodeCurrencyCode(assetCurrency) === decodeCurrencyCode(tokenCurrency));
}

function zeroAmount(amount) {
  if (typeof amount === "string") return "0";
  if (amount && typeof amount === "object") return { ...amount, value: "0" };
  return 0;
}

function deltaAmount(previous, finalValue) {
  const before = amountValue(previous);
  const after = amountValue(finalValue);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return Number.NaN;
  return Math.abs(before - after);
}

function extractDexTrades(txItem, currency, issuer) {
  const meta = txItem.meta || txItem.metaData || {};
  const tx = txItem.tx || txItem.tx_json || {};
  if (meta.TransactionResult && meta.TransactionResult !== "tesSUCCESS") return [];

  const time = normalizeTimestamp(tx.date ? tx.date + 946684800 : tx.close_time_iso || txItem.close_time_iso || txItem.date);
  if (!time) return [];

  const trades = [];
  const nodes = Array.isArray(meta.AffectedNodes) ? meta.AffectedNodes : [];
  for (const node of nodes) {
    const payload = node.ModifiedNode || node.DeletedNode || node.CreatedNode || null;
    if (!payload || payload.LedgerEntryType !== "Offer") continue;
    if (node.DeletedNode && tx.TransactionType === "OfferCancel") continue;

    const finalFields = payload.FinalFields || payload.NewFields || {};
    const previousFields = payload.PreviousFields || {};
    if (!finalFields.TakerGets || !finalFields.TakerPays) continue;

    const prevGets = previousFields.TakerGets || (node.DeletedNode ? finalFields.TakerGets : null);
    const prevPays = previousFields.TakerPays || (node.DeletedNode ? finalFields.TakerPays : null);
    if (!prevGets || !prevPays) continue;

    const nextGets = node.DeletedNode && !previousFields.TakerGets ? zeroAmount(finalFields.TakerGets) : finalFields.TakerGets;
    const nextPays = node.DeletedNode && !previousFields.TakerPays ? zeroAmount(finalFields.TakerPays) : finalFields.TakerPays;

    let xrpDelta = Number.NaN;
    let tokenDelta = Number.NaN;
    if (amountIsXrp(prevGets) && amountMatchesToken(prevPays, currency, issuer)) {
      xrpDelta = deltaAmount(prevGets, nextGets);
      tokenDelta = deltaAmount(prevPays, nextPays);
    } else if (amountIsXrp(prevPays) && amountMatchesToken(prevGets, currency, issuer)) {
      xrpDelta = deltaAmount(prevPays, nextPays);
      tokenDelta = deltaAmount(prevGets, nextGets);
    }

    if (xrpDelta > 0 && tokenDelta > 0) {
      trades.push({ t: time, price: xrpDelta / tokenDelta, volume: tokenDelta });
    }
  }
  return trades;
}

function candleBucketMs(period = "1d") {
  if (period === "5m") return 5 * 60_000;
  if (period === "15m") return 15 * 60_000;
  if (period === "1h") return 60 * 60_000;
  if (period === "4h") return 4 * 60 * 60_000;
  if (period === "1w") return 7 * 86_400_000;
  return 86_400_000;
}

function pointsToCandles(points, period) {
  const bucketMs = candleBucketMs(period);
  const buckets = new Map();
  points.sort((a, b) => a.t - b.t).forEach((point) => {
    const bucket = Math.floor(point.t / bucketMs) * bucketMs;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { t: bucket, o: point.price, h: point.price, l: point.price, c: point.price, v: point.volume || 0 });
      return;
    }
    current.h = Math.max(current.h, point.price);
    current.l = Math.min(current.l, point.price);
    current.c = point.price;
    current.v += point.volume || 0;
  });
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

async function xrplCommand(endpoint, command) {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is not available in this Node runtime.");
  }
  const id = nextWsId++;
  const socket = new WebSocket(endpoint);
  return await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error("XRPL websocket request timed out."));
    }, 12_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ ...command, id }));
    }, { once: true });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.id !== id) return;
        clearTimeout(timeoutId);
        socket.close();
        if (payload.status === "error" || payload.error) {
          reject(new Error(payload.error_message || payload.error || "XRPL command failed."));
          return;
        }
        resolve(payload.result || {});
      } catch (error) {
        clearTimeout(timeoutId);
        socket.close();
        reject(error);
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("XRPL websocket error."));
    }, { once: true });
  });
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

async function indexDexHistory({ network, issuer, currency, period }) {
  const endpoint = XRPL_WS_ENDPOINTS[network] || XRPL_WS_ENDPOINTS["xrpl-mainnet"];
  const trades = [];
  let marker = undefined;
  let pageCount = 0;

  while (pageCount < DEX_HISTORY_MAX_PAGES) {
    const result = await xrplCommand(endpoint, {
      command: "account_tx",
      account: issuer,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: DEX_HISTORY_PAGE_LIMIT,
      forward: false,
      marker
    });

    const txs = Array.isArray(result.transactions) ? result.transactions : [];
    if (!txs.length) break;

    pageCount += 1;
    for (const tx of txs) {
      trades.push(...extractDexTrades(tx, currency, issuer));
    }

    marker = result.marker;
    if (!marker) break;
    await sleep(120);
  }

  const points = trades
    .filter((trade) => Number.isFinite(trade.price) && trade.price > 0)
    .sort((a, b) => a.t - b.t);

  return {
    network,
    issuer,
    currency,
    period,
    pageCount,
    pointCount: points.length,
    candles: pointsToCandles(points, period),
    points
  };
}

async function proxyDexHistory(requestUrl) {
  const network = requestUrl.searchParams.get("network") || "xrpl-mainnet";
  const issuer = requestUrl.searchParams.get("issuer") || "";
  const currency = normalizeCurrency(requestUrl.searchParams.get("currency") || "");
  const period = requestUrl.searchParams.get("period") || "1d";

  if (!["xrpl-mainnet", "xrpl-testnet"].includes(network)) {
    throw Object.assign(new Error("Unsupported XRPL network."), { status: 400 });
  }
  if (!isValidXrplAddress(issuer)) {
    throw Object.assign(new Error("Invalid issuer address."), { status: 400 });
  }
  if (!currency || currency.length > 40 || !/^[A-Za-z0-9.$_-]+$/.test(currency)) {
    throw Object.assign(new Error("Invalid currency code."), { status: 400 });
  }
  if (!["5m", "15m", "1h", "4h", "1d", "1w"].includes(period)) {
    throw Object.assign(new Error("Unsupported candle period."), { status: 400 });
  }

  const cacheKey = `dex-history:${network}:${issuer}:${currency}:${period}`;
  const result = await getCached(cacheKey, DEX_HISTORY_CACHE_MS, async () => ({
    body: JSON.stringify(await indexDexHistory({ network, issuer, currency, period })),
    contentType: "application/json"
  }));

  return result;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== "/market" && requestUrl.pathname !== "/image" && requestUrl.pathname !== "/dex-history") {
      send(res, 404, JSON.stringify({ error: "Not found" }), { "Content-Type": "application/json" });
      return;
    }

    if (requestUrl.pathname === "/dex-history") {
      const result = await proxyDexHistory(requestUrl);
      send(res, 200, result.body, {
        "Content-Type": result.contentType,
        "X-IkeLedger-Cache": result.cacheHit ? "hit" : "miss"
      });
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
