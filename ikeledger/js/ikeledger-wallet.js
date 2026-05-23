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
  lastError: "",
  profile: {
    displayName: "Wayfinder Scholar",
    handle: "@ike-journey",
    bio: "Protecting a public XRPL address while keeping the profile layer private.",
    realm: "Dreamtime",
    initials: "WV"
  }
};

export function hydrateWalletState() {
  const network = localStorage.getItem(STORAGE_KEYS.network);
  const publicAddress = localStorage.getItem(STORAGE_KEYS.publicAddress);
  const displayName = localStorage.getItem(STORAGE_KEYS.profileDisplayName);
  const handle = localStorage.getItem(STORAGE_KEYS.profileHandle);
  const bio = localStorage.getItem(STORAGE_KEYS.profileBio);
  const realm = localStorage.getItem(STORAGE_KEYS.profileRealm);
  const initials = localStorage.getItem(STORAGE_KEYS.profileInitials);

  if (network && NETWORKS[network]) {
    state.network = network;
  }

  if (publicAddress && XRPL_ADDRESS_PATTERN.test(publicAddress)) {
    state.publicAddress = publicAddress;
    state.status = "Public address loaded";
  }

  state.profile = {
    displayName: displayName || state.profile.displayName,
    handle: handle || state.profile.handle,
    bio: bio || state.profile.bio,
    realm: realm || state.profile.realm,
    initials: initials || state.profile.initials
  };

  return getWalletState();
}

export function getWalletState() {
  return structuredClone(state);
}

export function getProfileState() {
  return structuredClone(state.profile);
}

export function updateProfileState(nextProfile) {
  state.profile = {
    ...state.profile,
    ...nextProfile
  };

  localStorage.setItem(STORAGE_KEYS.profileDisplayName, state.profile.displayName);
  localStorage.setItem(STORAGE_KEYS.profileHandle, state.profile.handle);
  localStorage.setItem(STORAGE_KEYS.profileBio, state.profile.bio);
  localStorage.setItem(STORAGE_KEYS.profileRealm, state.profile.realm);
  localStorage.setItem(STORAGE_KEYS.profileInitials, state.profile.initials);

  return getProfileState();
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
  // Preserve appearance preferences — they belong to the device, not the session
  const appearanceKeys = [
    STORAGE_KEYS.theme,
    STORAGE_KEYS.profilePhoto,
    STORAGE_KEYS.avatarGlowColor,
    STORAGE_KEYS.avatarGlowIntensity,
    STORAGE_KEYS.avatarBorderColor,
    STORAGE_KEYS.avatarBorderShape,
    STORAGE_KEYS.avatarBorderWidth
  ];
  const saved = {};
  appearanceKeys.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val !== null) saved[key] = val;
  });

  localStorage.clear();

  Object.entries(saved).forEach(([key, val]) => localStorage.setItem(key, val));

  state.status = "Disconnected";
  state.mode = "No wallet connected";
  state.publicAddress = "";
  state.snapshot = null;
  state.profile = {
    displayName: "Wayfinder Scholar",
    handle: "@ike-journey",
    bio: "Protecting a public XRPL address while keeping the profile layer private.",
    realm: "Dreamtime",
    initials: "WV"
  };
}
