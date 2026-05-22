import { NETWORKS } from "./ikeledger-config.js";

export function buildXamanConnectContext(networkKey, address) {
  const network = NETWORKS[networkKey] || NETWORKS["xrpl-testnet"];
  const deepLink = "https://xaman.app";

  return {
    provider: "Xaman",
    network: network.label,
    addressHint: address ? `${address.slice(0, 8)}...${address.slice(-6)}` : "No address yet",
    deepLink,
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
