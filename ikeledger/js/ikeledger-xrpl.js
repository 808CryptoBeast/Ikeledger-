import { NETWORKS } from "./ikeledger-config.js";

const WS_TIMEOUT_MS = 15000;

class XrplWsClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    if (this.isConnected()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.endpoint);
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            // noop
          }
          reject(new Error(`XRPL websocket connect timeout: ${this.endpoint}`));
        }
      }, WS_TIMEOUT_MS);

      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.ws = ws;
        resolve();
      });

      ws.addEventListener("message", (event) => {
        this.onMessage(event);
      });

      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(`XRPL websocket failed: ${this.endpoint}`));
        }
      });

      ws.addEventListener("close", () => {
        const message = "XRPL websocket connection closed.";
        for (const pending of this.pending.values()) {
          pending.reject(new Error(message));
        }
        this.pending.clear();

        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(new Error(message));
        }

        this.ws = null;
      });
    });
  }

  onMessage(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) return;

    this.pending.delete(payload.id);
    if (payload.status === "error" || payload.error) {
      const message = payload.error_message || payload.error || "XRPL request failed.";
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(payload);
  }

  request(body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("XRPL websocket is not connected."));
    }

    const id = this.nextId++;
    const requestBody = { ...body, id };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`XRPL request timeout for command: ${body.command || "unknown"}`));
      }, WS_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (payload) => {
          clearTimeout(timeoutId);
          resolve(payload);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      try {
        this.ws.send(JSON.stringify(requestBody));
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.ws.close();
    }
    this.ws = null;
    return Promise.resolve();
  }
}

function getNetwork(networkKey) {
  const network = NETWORKS[networkKey];
  if (!network) {
    throw new Error("Unsupported network selected.");
  }
  return network;
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

async function withClient(networkKey, callback) {
  const network = getNetwork(networkKey);
  const client = new XrplWsClient(network.endpoint);

  await client.connect();
  try {
    return await callback(client, network);
  } finally {
    if (client.isConnected()) {
      await client.disconnect();
    }
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

export async function fetchAccountSnapshot(address, networkKey) {
  return withClient(networkKey, async (client, network) => {
    const accountInfo = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated"
    }).catch((error) => {
      if (isAccountNotFoundError(error)) {
        throw new Error(`No funded XRPL account was found for this address on ${network.label}. Check the selected network or fund the address first.`);
      }
      throw error;
    });

    const linesResponse = await client.request({
      command: "account_lines",
      account: address,
      ledger_index: "validated",
      limit: 20
    });

    const txResponse = await client.request({
      command: "account_tx",
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 10,
      forward: false
    });

    const nftsResponse = await client.request({
      command: "account_nfts",
      account: address,
      limit: 20
    }).catch(() => ({ result: { account_nfts: [] } }));

    const gatewayBalancesResponse = await client.request({
      command: "gateway_balances",
      account: address,
      strict: true
    }).catch(() => ({ result: { obligations: {} } }));

    const accountObjectsResponse = await client.request({
      command: "account_objects",
      account: address,
      ledger_index: "validated",
      limit: 200
    }).catch(() => ({ result: { account_objects: [] } }));

    const serverInfoResponse = await client.request({
      command: "server_info"
    }).catch(() => ({ result: { info: {} } }));

    const balanceDrops = accountInfo.result.account_data.Balance;

    const txItems = (txResponse.result.transactions || []).map((item) => {
      const txJson = item.tx_json || {};
      const normalizedAmount = normalizeAmount(txJson.Amount);
      const memoHex = txJson.Memos?.[0]?.Memo?.MemoData;

      return {
        hash: txJson.hash || "Unknown",
        type: txJson.TransactionType || "Unknown",
        label: classifyTransaction(item),
        date: txJson.date || null,
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
    });

    const tokenHoldings = (linesResponse.result.lines || [])
      .map((line) => ({
        currency: line.currency || "Unknown",
        counterparty: line.account || "-",
        balance: line.balance || "0",
        limit: line.limit || "0"
      }))
      .sort((a, b) => Math.abs(toNumber(b.balance)) - Math.abs(toNumber(a.balance)));

    const issuedTokenEntries = Object.entries(gatewayBalancesResponse.result.obligations || {})
      .map(([currency, amount]) => ({
        currency,
        amount: String(amount),
        issuer: address
      }))
      .sort((a, b) => toNumber(b.amount) - toNumber(a.amount));

    const nftItems = (nftsResponse.result.account_nfts || []).map((nft) => ({
      nftId: nft.NFTokenID,
      issuer: nft.Issuer || "-",
      taxon: nft.NFTokenTaxon ?? "-",
      transferFee: nft.TransferFee ?? "-",
      uri: decodeHexUri(nft.URI || nft.uri || "")
    }));

    const ammObjects = (accountObjectsResponse.result.account_objects || []).filter((obj) =>
      String(obj.LedgerEntryType || "").toLowerCase().includes("amm")
    );

    const ammActivity = txItems.filter((tx) =>
      ["AMMDeposit", "AMMWithdraw", "AMMVote", "AMMBid", "AMMCreate", "AMMDelete"].includes(tx.type)
    );

    const balanceXrp = dropsToXrp(balanceDrops);
    const reserveBaseDrops = serverInfoResponse.result?.info?.validated_ledger?.reserve_base_xrp
      ? String(Math.round(Number.parseFloat(serverInfoResponse.result.info.validated_ledger.reserve_base_xrp) * 1000000))
      : "10000000";
    const reserveIncDrops = serverInfoResponse.result?.info?.validated_ledger?.reserve_inc_xrp
      ? String(Math.round(Number.parseFloat(serverInfoResponse.result.info.validated_ledger.reserve_inc_xrp) * 1000000))
      : "2000000";
    const ownerReserveDrops = String(
      toNumber(reserveBaseDrops) + toNumber(reserveIncDrops) * (accountInfo.result.account_data.OwnerCount || 0)
    );
    const availableDrops = Math.max(toNumber(balanceDrops) - toNumber(ownerReserveDrops), 0).toString();
    const valueMix = buildValueMix(balanceXrp, tokenHoldings);

    return {
      network,
      accountExists: true,
      account: {
        address,
        sequence: accountInfo.result.account_data.Sequence,
        balanceXrp,
        availableXrp: dropsToXrp(availableDrops),
        ownerReserveXrp: dropsToXrp(ownerReserveDrops),
        ownerCount: accountInfo.result.account_data.OwnerCount,
        flags: accountInfo.result.account_data.Flags,
        trustLines: linesResponse.result.lines?.length || 0,
        nftCount: nftsResponse.result.account_nfts?.length || 0,
        recentActivityCount: txItems.length,
        accountStatus: accountInfo.result.account_data.AccountTxnID ? "Configured" : "Active"
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
  });
}
