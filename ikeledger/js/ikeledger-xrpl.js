import { NETWORKS } from "./ikeledger-config.js";

let xrplModule;

function getNetwork(networkKey) {
  const network = NETWORKS[networkKey];
  if (!network) {
    throw new Error("Unsupported network selected.");
  }
  return network;
}

async function loadXrpl() {
  if (!xrplModule) {
    xrplModule = await import("https://esm.sh/xrpl@4.2.5?bundle");
  }
  return xrplModule;
}

async function withClient(networkKey, callback) {
  const { Client } = await loadXrpl();
  const network = getNetwork(networkKey);
  const client = new Client(network.endpoint);

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

function normalizeAmount(xrpl, amount) {
  if (!amount) {
    return { value: "-", asset: "XRP" };
  }

  if (typeof amount === "string") {
    return { value: xrpl.dropsToXrp(amount), asset: "XRP" };
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
    const xrpl = await loadXrpl();

    const txItems = (txResponse.result.transactions || []).map((item) => {
      const txJson = item.tx_json || {};
      const normalizedAmount = normalizeAmount(xrpl, txJson.Amount);
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
      transferFee: nft.TransferFee ?? "-"
    }));

    const ammObjects = (accountObjectsResponse.result.account_objects || []).filter((obj) =>
      String(obj.LedgerEntryType || "").toLowerCase().includes("amm")
    );

    const ammActivity = txItems.filter((tx) =>
      ["AMMDeposit", "AMMWithdraw", "AMMVote", "AMMBid", "AMMCreate", "AMMDelete"].includes(tx.type)
    );

    const balanceXrp = xrpl.dropsToXrp(balanceDrops);
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
        availableXrp: xrpl.dropsToXrp(availableDrops),
        ownerReserveXrp: xrpl.dropsToXrp(ownerReserveDrops),
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
