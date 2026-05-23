import { NETWORKS } from "./ikeledger-config.js";

export function buildXamanConnectContext(networkKey, address) {
  const network = NETWORKS[networkKey] || NETWORKS["xrpl-testnet"];
  return {
    provider: "Xaman",
    network: network.label,
    addressHint: address ? `${address.slice(0, 8)}...${address.slice(-6)}` : "No address yet",
    deepLink: "https://xaman.app",
    note: "Open Xaman and approve the connection request after payload service integration."
  };
}

export function openXamanConnect(networkKey, address) {
  const context = buildXamanConnectContext(networkKey, address);
  if (typeof window !== "undefined") {
    window.open(context.deepLink, "_blank", "noopener,noreferrer");
  }
  return context;
}

export function xrpToDrops(xrpAmount) {
  const num = parseFloat(xrpAmount);
  if (!isFinite(num) || num < 0) throw new Error("Invalid XRP amount.");
  return String(Math.round(num * 1_000_000));
}

export function buildPaymentTx({ account, destination, amountXrp, destinationTag, memo }) {
  if (!account)     throw new Error("Sender account address is required.");
  if (!destination) throw new Error("Destination address is required.");
  if (!amountXrp)  throw new Error("Amount is required.");

  const drops = xrpToDrops(amountXrp);

  const tx = {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: drops,
    Fee: "12"
  };

  const tag = parseInt(destinationTag, 10);
  if (!isNaN(tag) && tag >= 0) {
    tx.DestinationTag = tag;
  }

  if (memo && memo.trim()) {
    const hex = Array.from(new TextEncoder().encode(memo.trim()))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    tx.Memos = [{ Memo: { MemoData: hex, MemoType: "746578742F706C61696E" } }];
  }

  return tx;
}

// Builds a Xaman-compatible sign URL (opens in Xaman mobile app)
export function buildXamanSignUrl(txJson) {
  const encoded = btoa(JSON.stringify(txJson));
  return `https://xaman.app/tx#${encoded}`;
}
