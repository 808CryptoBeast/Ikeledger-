import {
  DEFAULT_NETWORK,
  NETWORKS,
  STORAGE_KEYS,
  XRPL_ADDRESS_PATTERN
} from "./ikeledger-config.js";
import { fetchAccountSnapshot } from "./ikeledger-xrpl.js";

const state = {
  status: "Disconnected",
  mode: "Read-only Mode",
  network: DEFAULT_NETWORK,
  publicAddress: "",
  provider: null,
  snapshot: null,
  lastError: ""
};

export function hydrateWalletState() {
  const network = localStorage.getItem(STORAGE_KEYS.network);
  const publicAddress = localStorage.getItem(STORAGE_KEYS.publicAddress);

  if (network && NETWORKS[network]) {
    state.network = network;
  }

  if (publicAddress && XRPL_ADDRESS_PATTERN.test(publicAddress)) {
    state.publicAddress = publicAddress;
    state.status = "Public address loaded";
  }

  return getWalletState();
}

export function getWalletState() {
  return structuredClone(state);
}

export function setNetwork(networkKey) {
  if (!NETWORKS[networkKey]) {
    throw new Error("Invalid network selected.");
  }

  state.network = networkKey;
  localStorage.setItem(STORAGE_KEYS.network, networkKey);
}

export function setPublicAddress(address) {
  state.publicAddress = address;

  if (address) {
    localStorage.setItem(STORAGE_KEYS.publicAddress, address);
  } else {
    localStorage.removeItem(STORAGE_KEYS.publicAddress);
  }
}

export async function lookupReadOnlyAddress(address) {
  if (!XRPL_ADDRESS_PATTERN.test(address)) {
    throw new Error("Please enter a valid XRPL classic address.");
  }

  state.status = "Read-only Mode";
  state.mode = "Read-only Mode";
  state.lastError = "";
  state.publicAddress = address;
  localStorage.setItem(STORAGE_KEYS.publicAddress, address);

  try {
    const snapshot = await fetchAccountSnapshot(address, state.network);
    state.snapshot = snapshot;
    state.status = "Wallet verified";
    return snapshot;
  } catch (error) {
    state.snapshot = null;
    state.status = "Connection expired";
    state.lastError = error instanceof Error ? error.message : "Failed to query account.";
    throw error;
  }
}

export function disconnectWallet() {
  state.status = "Disconnected";
  state.mode = "No wallet connected";
  state.provider = null;
  state.publicAddress = "";
  state.snapshot = null;
  state.lastError = "";
  localStorage.removeItem(STORAGE_KEYS.publicAddress);
}

export function clearSessionStorage() {
  const keepTheme = localStorage.getItem(STORAGE_KEYS.theme);
  localStorage.clear();

  if (keepTheme) {
    localStorage.setItem(STORAGE_KEYS.theme, keepTheme);
  }

  state.status = "Disconnected";
  state.mode = "No wallet connected";
  state.publicAddress = "";
  state.snapshot = null;
}
