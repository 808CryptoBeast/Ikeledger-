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
        validated: Boolean(item.validated)
      };
    });

    return {
      network,
      accountExists: true,
      account: {
        address,
        sequence: accountInfo.result.account_data.Sequence,
        balanceXrp: xrpl.dropsToXrp(balanceDrops),
        ownerCount: accountInfo.result.account_data.OwnerCount,
        flags: accountInfo.result.account_data.Flags,
        trustLines: linesResponse.result.lines?.length || 0,
        nftCount: nftsResponse.result.account_nfts?.length || 0
      },
      txItems
    };
  });
}
