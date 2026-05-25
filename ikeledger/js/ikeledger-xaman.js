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
