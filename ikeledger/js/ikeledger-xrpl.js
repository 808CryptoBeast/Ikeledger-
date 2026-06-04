import { NETWORKS } from "./ikeledger-config.js";

const WS_TIMEOUT_MS = 15000;

const sharedSockets = new Map();
const sharedPending = new Map();
const sharedOpenPromises = new Map();
const sharedStreamHandlers = new Map();
let sharedNextId = 1;

function getNetwork(networkKey) {
  const network = NETWORKS[networkKey];
  if (!network) {
    throw new Error("Unsupported network selected.");
  }
  return network;
}

function normalizeNetworkKey(networkKey) {
  return getNetwork(networkKey).key || networkKey;
}

function getNetworkEndpoints(network) {
  const endpoints = Array.isArray(network.endpoints) && network.endpoints.length
    ? network.endpoints
    : [network.endpoint];
  return endpoints
    .filter(Boolean)
    .filter((endpoint, index, list) => list.indexOf(endpoint) === index);
}

function rejectPendingRequests(networkKey, message) {
  const pending = sharedPending.get(networkKey);
  if (!pending) return;

  for (const entry of pending.values()) {
    clearTimeout(entry.timeoutId);
    entry.reject(new Error(message));
  }
  pending.clear();
}

function routeStreamPayload(networkKey, payload) {
  if (payload?.type !== "transaction" && payload?.type !== "ledgerClosed") return false;

  const handlers = sharedStreamHandlers.get(networkKey);
  if (!handlers?.size) return true;

  handlers.forEach((handler) => {
    try {
      handler(payload);
    } catch {
      // A single stream consumer should not break the shared socket.
    }
  });

  return true;
}

function routeResponsePayload(networkKey, payload) {
  if (routeStreamPayload(networkKey, payload)) return;

  const pending = sharedPending.get(networkKey);
  const entry = pending?.get(payload?.id);
  if (!entry) return;

  pending.delete(payload.id);
  clearTimeout(entry.timeoutId);

  if (payload.status === "error" || payload.error) {
    entry.reject(new Error(payload.error_message || payload.error || "XRPL request failed."));
    return;
  }

  entry.resolve(payload.result || {});
}

export function ensureXrplConnection(networkKey) {
  const network = getNetwork(networkKey);
  const key = network.key || networkKey;
  const existing = sharedSockets.get(key);

  if (existing?.readyState === WebSocket.OPEN) return Promise.resolve(existing);
  if (existing?.readyState === WebSocket.CONNECTING && sharedOpenPromises.has(key)) {
    return sharedOpenPromises.get(key);
  }

  const pending = sharedPending.get(key) || new Map();
  const endpoints = getNetworkEndpoints(network);
  sharedPending.set(key, pending);

  const openPromise = new Promise((resolve, reject) => {
    let connected = false;
    let attemptIndex = 0;
    let lastError = "";

    const cleanupEstablishedSocket = (socket, message) => {
      if (sharedSockets.get(key) !== socket) return;
      rejectPendingRequests(key, message);
      sharedPending.delete(key);
      sharedSockets.delete(key);
      sharedOpenPromises.delete(key);
    };

    const failAll = () => {
      sharedOpenPromises.delete(key);
      sharedPending.delete(key);
      sharedSockets.delete(key);
      reject(new Error(lastError || `XRPL websocket error: ${network.label}`));
    };

    const tryEndpoint = () => {
      if (connected) return;
      const endpoint = endpoints[attemptIndex];
      attemptIndex += 1;

      if (!endpoint) {
        failAll();
        return;
      }

      const socket = new WebSocket(endpoint);
      let endpointSettled = false;
      sharedSockets.set(key, socket);

      const timeoutId = setTimeout(() => {
        if (endpointSettled || connected) return;
        endpointSettled = true;
        lastError = `XRPL websocket connect timeout: ${network.label} (${endpoint})`;
        if (sharedSockets.get(key) === socket) sharedSockets.delete(key);
        try {
          socket.close();
        } catch {
          // noop
        }
        tryEndpoint();
      }, WS_TIMEOUT_MS);

      const failEndpoint = (message) => {
        if (endpointSettled || connected) return;
        endpointSettled = true;
        lastError = message;
        clearTimeout(timeoutId);
        if (sharedSockets.get(key) === socket) sharedSockets.delete(key);
        try {
          socket.close();
        } catch {
          // noop
        }
        tryEndpoint();
      };

      socket.addEventListener("open", () => {
        if (endpointSettled || connected) return;
        endpointSettled = true;
        connected = true;
        clearTimeout(timeoutId);
        sharedOpenPromises.delete(key);
        resolve(socket);
      }, { once: true });
      socket.addEventListener("message", (event) => {
        try {
          routeResponsePayload(key, JSON.parse(event.data));
        } catch {
          // Ignore malformed WebSocket payloads.
        }
      });
      socket.addEventListener("error", () => {
        if (connected) {
          cleanupEstablishedSocket(socket, `XRPL websocket error: ${network.label} (${endpoint})`);
          return;
        }
        failEndpoint(`XRPL websocket error: ${network.label} (${endpoint})`);
      }, { once: true });
      socket.addEventListener("close", () => {
        if (connected) {
          cleanupEstablishedSocket(socket, `XRPL websocket closed: ${network.label} (${endpoint})`);
          return;
        }
        failEndpoint(`XRPL websocket closed: ${network.label} (${endpoint})`);
      }, { once: true });
    };

    tryEndpoint();
  });

  sharedOpenPromises.set(key, openPromise);
  return openPromise;
}

export async function requestXrplCommand(networkKey, command, options = {}) {
  const network = getNetwork(networkKey);
  const key = network.key || networkKey;
  const socket = await ensureXrplConnection(key);
  const pending = sharedPending.get(key);
  if (!pending || socket.readyState !== WebSocket.OPEN) {
    throw new Error("XRPL websocket is not connected.");
  }

  const id = sharedNextId++;
  const timeoutMs = options.timeoutMs || WS_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`XRPL request timeout for command: ${command.command || "unknown"}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timeoutId });

    try {
      socket.send(JSON.stringify({ ...command, id }));
    } catch (error) {
      clearTimeout(timeoutId);
      pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function addXrplStreamHandler(networkKey, handler) {
  const key = normalizeNetworkKey(networkKey);
  if (!sharedStreamHandlers.has(key)) sharedStreamHandlers.set(key, new Set());
  sharedStreamHandlers.get(key).add(handler);
}

export function removeXrplStreamHandler(networkKey, handler) {
  const key = normalizeNetworkKey(networkKey);
  sharedStreamHandlers.get(key)?.delete(handler);
}

export function closeXrplConnection(networkKey) {
  const key = normalizeNetworkKey(networkKey);
  const socket = sharedSockets.get(key);
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }
  rejectPendingRequests(key, "XRPL websocket closed.");
  sharedPending.delete(key);
  sharedSockets.delete(key);
  sharedOpenPromises.delete(key);
}

function isAccountNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /actNotFound|Account not found|account.*not.*found/i.test(message);
}

function dropsToXrp(drops) {
  const value = toNumber(drops);
  return (value / 1000000).toString();
}

function decodeHexUri(uri) {
  if (!uri) return "";
  const clean = String(uri).trim();
  if (!/^[0-9A-Fa-f]+$/.test(clean) || clean.length % 2 !== 0) {
    return clean;
  }

  try {
    const bytes = clean.match(/.{1,2}/g).map((hex) => Number.parseInt(hex, 16));
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\0/g, "").trim();
  } catch {
    return clean;
  }
}

function classifyTransaction(tx) {
  const type = tx?.tx_json?.TransactionType || "Unknown";

  if (type === "Payment") {
    return "Payment movement";
  }

  if (type === "TrustSet") {
    return "Trust line created or updated";
  }

  if (type === "NFTokenMint") {
    return "NFT minted";
  }

  if (type === "OfferCreate") {
    return "Offer created";
  }

  if (type === "AMMDeposit") {
    return "AMM deposit";
  }

  if (type === "AMMWithdraw") {
    return "AMM withdraw";
  }

  if (type === "OfferCancel") {
    return "Offer cancelled";
  }

  if (type === "AccountSet") {
    return "Account settings updated";
  }

  if (type === "EscrowCreate" || type === "EscrowFinish" || type === "EscrowCancel") {
    return "Escrow action";
  }

  if (type === "PaymentChannelCreate" || type === "PaymentChannelFund" || type === "PaymentChannelClaim") {
    return "Payment channel action";
  }

  return type;
}

function normalizeAmount(amount) {
  if (!amount) {
    return { value: "-", asset: "XRP" };
  }

  if (typeof amount === "string") {
    return { value: dropsToXrp(amount), asset: "XRP" };
  }

  return {
    value: amount.value || "-",
    asset: amount.currency || "Issued Asset"
  };
}

function formatOfferAmount(amount) {
  const normalized = normalizeAmount(amount);
  return `${normalized.value} ${normalized.asset}`;
}

async function fetchNftOfferSummary(request, nftId) {
  const [sellResponse, buyResponse] = await Promise.all([
    request({ command: "nft_sell_offers", nft_id: nftId }).catch(() => ({ offers: [] })),
    request({ command: "nft_buy_offers", nft_id: nftId }).catch(() => ({ offers: [] }))
  ]);

  const sellOffers = sellResponse.offers || [];
  const buyOffers = buyResponse.offers || [];

  return {
    sellOffers: sellOffers.length,
    buyOffers: buyOffers.length,
    lowestSell: sellOffers[0]?.amount ? formatOfferAmount(sellOffers[0].amount) : "",
    highestBuy: buyOffers[0]?.amount ? formatOfferAmount(buyOffers[0].amount) : ""
  };
}

export async function fetchNftOfferSummaries(nftsOrIds, networkKey, options = {}) {
  const limit = Math.max(1, Number(options.limit || 24));
  const ids = nftsOrIds
    .map((entry) => typeof entry === "string" ? entry : entry?.nftId || entry?.NFTokenID || "")
    .filter(Boolean)
    .slice(0, limit);
  const request = (command) => requestXrplCommand(networkKey, command, options);

  const entries = await Promise.all(ids.map(async (nftId) => ({
    nftId,
    offers: await fetchNftOfferSummary(request, nftId)
  })));

  return entries.reduce((acc, entry) => {
    acc[entry.nftId] = entry.offers;
    return acc;
  }, {});
}

function toNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildValueMix(balanceXrp, tokenHoldings) {
  const xrpUnits = Math.max(toNumber(balanceXrp), 0);
  const tokenUnits = tokenHoldings
    .map((token) => Math.max(Math.abs(toNumber(token.balance)), 0))
    .reduce((sum, amount) => sum + amount, 0);
  const total = xrpUnits + tokenUnits;

  if (!total) {
    return [];
  }

  const slices = [
    {
      label: "XRP",
      units: xrpUnits,
      percentage: (xrpUnits / total) * 100,
      note: `${xrpUnits.toFixed(4)} XRP`
    },
    ...tokenHoldings
      .map((token) => {
        const units = Math.max(Math.abs(toNumber(token.balance)), 0);
        return {
          label: `${token.currency} (${token.counterparty})`,
          units,
          percentage: (units / total) * 100,
          note: `${token.balance} ${token.currency}`
        };
      })
      .filter((entry) => entry.units > 0)
  ];

  return slices.sort((a, b) => b.percentage - a.percentage).slice(0, 8);
}

function normalizeTransactionItem(item = {}) {
  const txJson = item.tx_json || item.tx || {};
  const normalizedAmount = normalizeAmount(txJson.Amount);
  const memoHex = txJson.Memos?.[0]?.Memo?.MemoData;

  return {
    hash: txJson.hash || item.hash || "Unknown",
    type: txJson.TransactionType || "Unknown",
    label: classifyTransaction({ ...item, tx_json: txJson }),
    date: txJson.date || item.close_time_iso || null,
    fee: txJson.Fee || "0",
    sendingAccount: txJson.Account || "-",
    receivingAccount: txJson.Destination || "-",
    amount: normalizedAmount.value,
    asset: normalizedAmount.asset,
    destinationTag: txJson.DestinationTag ?? null,
    memo: memoHex || null,
    validated: Boolean(item.validated),
    raw: txJson
  };
}

function normalizeTokenHolding(line = {}) {
  return {
    currency: line.currency || "Unknown",
    counterparty: line.account || "-",
    balance: line.balance || "0",
    limit: line.limit || "0"
  };
}

function normalizeNftItem(nft = {}) {
  return {
    nftId: nft.NFTokenID,
    issuer: nft.Issuer || "-",
    taxon: nft.NFTokenTaxon ?? "-",
    transferFee: nft.TransferFee ?? "-",
    uri: decodeHexUri(nft.URI || nft.uri || "")
  };
}

export async function fetchAccountTransactionsPage(address, networkKey, options = {}) {
  const result = await requestXrplCommand(networkKey, {
    command: "account_tx",
    account: address,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: options.limit || 20,
    marker: options.marker || undefined,
    forward: false
  });

  return {
    items: (result.transactions || []).map(normalizeTransactionItem),
    marker: result.marker || null
  };
}

export async function fetchAccountLinesPage(address, networkKey, options = {}) {
  const result = await requestXrplCommand(networkKey, {
    command: "account_lines",
    account: address,
    ledger_index: "validated",
    limit: options.limit || 200,
    marker: options.marker || undefined
  });

  return {
    items: (result.lines || []).map(normalizeTokenHolding),
    marker: result.marker || null
  };
}

export async function fetchAccountNftsPage(address, networkKey, options = {}) {
  const result = await requestXrplCommand(networkKey, {
    command: "account_nfts",
    account: address,
    limit: options.limit || 100,
    marker: options.marker || undefined
  }).catch(() => ({ account_nfts: [], marker: null }));

  return {
    items: (result.account_nfts || []).map(normalizeNftItem),
    marker: result.marker || null
  };
}

export async function fetchAccountSnapshot(address, networkKey, options = {}) {
  const network = getNetwork(networkKey);
  const includeNftOffers = options.includeNftOffers === true;
  const request = (command) => requestXrplCommand(network.key, command, options);

  const accountInfo = await request({
    command: "account_info",
    account: address,
    ledger_index: "validated"
  }).catch((error) => {
    if (isAccountNotFoundError(error)) {
      throw new Error(`No funded XRPL account was found for this address on ${network.label}. Check the selected network or fund the address first.`);
    }
    throw error;
  });

  const [
    linesResponse,
    txResponse,
    nftsResponse,
    gatewayBalancesResponse,
    accountObjectsResponse,
    serverInfoResponse
  ] = await Promise.all([
    request({
      command: "account_lines",
      account: address,
      ledger_index: "validated",
      limit: options.trustLineLimit || 200
    }),
    request({
      command: "account_tx",
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: options.txLimit || 10,
      forward: false
    }),
    request({
      command: "account_nfts",
      account: address,
      limit: options.nftLimit || 100
    }).catch(() => ({ account_nfts: [], marker: null })),
    request({
      command: "gateway_balances",
      account: address,
      strict: true
    }).catch(() => ({ obligations: {} })),
    request({
      command: "account_objects",
      account: address,
      ledger_index: "validated",
      limit: options.objectLimit || 200
    }).catch(() => ({ account_objects: [], marker: null })),
    request({ command: "server_info" }).catch(() => ({ info: {} }))
  ]);

  const accountData = accountInfo.account_data || {};
  const balanceDrops = accountData.Balance || "0";
  const txItems = (txResponse.transactions || []).map(normalizeTransactionItem);
  const tokenHoldings = (linesResponse.lines || [])
    .map(normalizeTokenHolding)
    .sort((a, b) => Math.abs(toNumber(b.balance)) - Math.abs(toNumber(a.balance)));

  const issuedTokenEntries = Object.entries(gatewayBalancesResponse.obligations || {})
    .map(([currency, amount]) => ({
      currency,
      amount: String(amount),
      issuer: address
    }))
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount));

  const nftItems = (nftsResponse.account_nfts || []).map(normalizeNftItem);
  if (includeNftOffers && nftItems.length) {
    const offerMap = await fetchNftOfferSummaries(nftItems, network.key, {
      ...options,
      limit: options.nftOfferLimit || 12
    });
    nftItems.forEach((nft) => {
      nft.offers = offerMap[nft.nftId] || {
        sellOffers: 0,
        buyOffers: 0,
        lowestSell: "",
        highestBuy: ""
      };
    });
  }

  const accountObjects = accountObjectsResponse.account_objects || [];
  const ammObjects = accountObjects.filter((obj) =>
    String(obj.LedgerEntryType || "").toLowerCase().includes("amm")
  );

  const ammActivity = txItems.filter((tx) =>
    ["AMMDeposit", "AMMWithdraw", "AMMVote", "AMMBid", "AMMCreate", "AMMDelete"].includes(tx.type)
  );

  const validatedLedger = serverInfoResponse.info?.validated_ledger || {};
  const balanceXrp = dropsToXrp(balanceDrops);
  const reserveBaseDrops = validatedLedger.reserve_base_xrp
    ? String(Math.round(Number.parseFloat(validatedLedger.reserve_base_xrp) * 1000000))
    : "10000000";
  const reserveIncDrops = validatedLedger.reserve_inc_xrp
    ? String(Math.round(Number.parseFloat(validatedLedger.reserve_inc_xrp) * 1000000))
    : "2000000";
  const ownerReserveDrops = String(toNumber(reserveBaseDrops) + toNumber(reserveIncDrops) * (accountData.OwnerCount || 0));
  const availableDrops = Math.max(toNumber(balanceDrops) - toNumber(ownerReserveDrops), 0).toString();
  const valueMix = buildValueMix(balanceXrp, tokenHoldings);

  return {
    network,
    accountExists: true,
    markers: {
      trustLines: linesResponse.marker || null,
      transactions: txResponse.marker || null,
      nfts: nftsResponse.marker || null,
      objects: accountObjectsResponse.marker || null
    },
    account: {
      address,
      sequence: accountData.Sequence,
      balanceXrp,
      availableXrp: dropsToXrp(availableDrops),
      ownerReserveXrp: dropsToXrp(ownerReserveDrops),
      ownerCount: accountData.OwnerCount || 0,
      flags: accountData.Flags || 0,
      trustLines: linesResponse.lines?.length || 0,
      nftCount: nftsResponse.account_nfts?.length || 0,
      recentActivityCount: txItems.length,
      accountStatus: accountData.AccountTxnID ? "Configured" : "Active"
    },
    tokenHoldings,
    issuedTokenEntries,
    nftItems,
    amm: {
      objectCount: ammObjects.length,
      recentActivityCount: ammActivity.length,
      recentActivity: ammActivity
    },
    valueMix,
    txItems
  };
}
