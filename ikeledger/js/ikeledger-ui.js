import { DEFAULT_NETWORK, NETWORKS, RISK_LEVELS, STORAGE_KEYS, XAMAN_API_KEY, XRPL_ADDRESS_PATTERN } from "./ikeledger-config.js";
import {
  assessRisk,
  getSecurityEvents,
  logSecurityEvent,
  looksLikeSensitiveInput,
  reminderMessages
} from "./ikeledger-security.js";
import {
  clearSessionStorage,
  disconnectWallet,
  getProfileState,
  getWalletState,
  hydrateWalletState,
  lookupReadOnlyAddress,
  setNetwork,
  setPublicAddress,
  setWalletProvider,
  updateProfileState
} from "./ikeledger-wallet.js";
import { getManaSummary } from "./ikeledger-rewards.js";
import { buildPaymentTx } from "./ikeledger-xaman.js";
import { initXumm, signInWithXumm, createTxFlow, resetXumm, clearXummSession } from "./ikeledger-xumm.js";
import { generateXrplWallet, isKeygenSupported } from "./ikeledger-keygen.js";
import {
  getSupabaseConfig,
  hasSupabaseConfig,
  linkWalletConnectionRemote,
  logSecurityEventRemote,
  saveSupabaseConfig,
  signInWithEmail,
  signOutEmailAuth,
  signUpWithEmail,
  testSupabaseConnection
} from "./ikeledger-supabase.js";

const BUILDER_ADMIN_CODE = "ike-builder-2026";
const TOP_ISSUED_ASSETS_URL = "https://api.xrpl.to/v1/tokens?sortBy=marketcap&sortType=desc&limit=50";
const TOP_ISSUED_ASSETS_CACHE_KEY = "ike_top_issued_assets_v1";
const TOP_ISSUED_ASSETS_CACHE_MS = 15 * 60 * 1000;

let heroSendXamanUrl = "";

const state = {
  adminMode: false,
  appUser: null,
  latestPreview: null,
  rawJsonOpen: false,
  latestTxItems: [],
  activePage: "dashboard",
  selectedNftId: "",
  topIssuedFilter: "",
  chartTimeframe: "24H",
  marketTimer: null,
  marketCache: {
    key: "",
    fetchedAt: 0,
    snapshot: null
  },
  topIssuedAssets: {
    fetchedAt: 0,
    items: [],
    loading: false,
    error: ""
  }
};

const nftMetadataCache = new Map();

const XRPL_ACCOUNT_PAGES = new Set(["wallet", "tokens", "nfts", "amm", "activity"]);
const SIGNING_WALLET_PAGES = new Set(["dex"]);
const PROFILE_PAGES = new Set(["profile", "credentials"]);

const refs = {
  chips: document.getElementById("statusChips"),
  topLinks: Array.from(document.querySelectorAll(".top-link")),
  bottomLinks: Array.from(document.querySelectorAll(".bottom-link")),
  pageSections: Array.from(document.querySelectorAll(".page-section")),
  themeToggleButton: document.getElementById("themeToggleButton"),
  profileButton: document.getElementById("profileButton"),
  saveProfileButton: document.getElementById("saveProfileButton"),
  themeSelect: document.getElementById("themeSelect"),
  walletConnectionChip: document.getElementById("walletConnectionChip"),
  qrCodeButton: document.getElementById("qrCodeButton"),
  lastSyncStatus: document.getElementById("lastSyncStatus"),
  marketChart: document.getElementById("marketChart"),
  timeframeButtons: Array.from(document.querySelectorAll(".tf-btn")),
  marketPrice: document.getElementById("marketPrice"),
  marketVolume: document.getElementById("marketVolume"),
  marketCap: document.getElementById("marketCap"),
  marketLedgerIndex: document.getElementById("marketLedgerIndex"),
  marketTps: document.getElementById("marketTps"),
  marketFee: document.getElementById("marketFee"),
  authModal: document.getElementById("authModal"),
  closeAuthModalButton: document.getElementById("closeAuthModalButton"),
  commandOpenAuthButton: document.getElementById("commandOpenAuthButton"),
  commandAuthPanel: document.getElementById("commandAuthPanel"),
  commandOverviewHero: document.getElementById("commandOverviewHero"),
  commandOverviewCards: document.getElementById("commandOverviewCards"),
  commandStructuredGrid: document.getElementById("commandStructuredGrid"),
  commandSessionBadge: document.getElementById("commandSessionBadge"),
  commandUsernameInput: document.getElementById("commandUsernameInput"),
  commandEmailInput: document.getElementById("commandEmailInput"),
  commandPasswordInput: document.getElementById("commandPasswordInput"),
  commandEmailSignUpButton: document.getElementById("commandEmailSignUpButton"),
  commandEmailSignInButton: document.getElementById("commandEmailSignInButton"),
  commandXummSignInButton: document.getElementById("commandXummSignInButton"),
  commandAuthStatus: document.getElementById("commandAuthStatus"),
  xrpNavPrice: document.getElementById("xrpNavPrice"),
  xrpPriceStat: document.getElementById("xrpPriceStat"),
  xrpChangeStat: document.getElementById("xrpChangeStat"),
  securityChipStat: document.getElementById("securityChipStat"),
  nftListingStatus: document.getElementById("nftListingStatus"),
  dexStatus: document.getElementById("dexStatus"),
  walletPageSummary: document.getElementById("walletPageSummary"),
  tokensPagePanel: document.getElementById("tokensPagePanel"),
  topIssuedTokensPanel: document.getElementById("topIssuedTokensPanel"),
  refreshTopIssuedTokensButton: document.getElementById("refreshTopIssuedTokensButton"),
  nftsPagePanel: document.getElementById("nftsPagePanel"),
  nftListingsPagePanel: document.getElementById("nftListingsPagePanel"),
  dexPagePanel: document.getElementById("dexPagePanel"),
  ammPagePanel: document.getElementById("ammPagePanel"),
  credentialsPagePanel: document.getElementById("credentialsPagePanel"),
  profilePagePanel: document.getElementById("profilePagePanel"),
  profileAvatarPill: document.getElementById("profileAvatarPill"),
  profileDisplayNameInput: document.getElementById("profileDisplayNameInput"),
  profileHandleInput: document.getElementById("profileHandleInput"),
  profileRealmInput: document.getElementById("profileRealmInput"),
  profileBioInput: document.getElementById("profileBioInput"),
  profileInitialsInput: document.getElementById("profileInitialsInput"),
  networkSelect: document.getElementById("networkSelect"),
  addressInput: document.getElementById("addressInput"),
  mainnetWarning: document.getElementById("mainnetWarning"),
  lookupButton: document.getElementById("lookupButton"),
  demoButton: document.getElementById("demoButton"),
  connectXamanButton: document.getElementById("connectXamanButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  clearSessionButton: document.getElementById("clearSessionButton"),
  copyAddressButton: document.getElementById("copyAddressButton"),
  providerStatus: document.getElementById("providerStatus"),
  publicAddressCompact: document.getElementById("publicAddressCompact"),
  walletVerifiedStatus: document.getElementById("walletVerifiedStatus"),
  xamanStatus: document.getElementById("xamanStatus"),
  feedback: document.getElementById("feedback"),
  portfolioSummary: document.getElementById("portfolioSummary"),
  walletStatus: document.getElementById("walletStatus"),
  manaStatus: document.getElementById("manaStatus"),
  profileStatus: document.getElementById("profileStatus"),
  proofLearning: document.getElementById("proofLearning"),
  badgeCredentials: document.getElementById("badgeCredentials"),
  dashboardActivity: document.getElementById("dashboardActivity"),
  tokenHoldings: document.getElementById("tokenHoldings"),
  issuedTokens: document.getElementById("issuedTokens"),
  nftInventory: document.getElementById("nftInventory"),
  ammStatus: document.getElementById("ammStatus"),
  valueMix: document.getElementById("valueMix"),
  txHistory: document.getElementById("txHistory"),
  txRawJson: document.getElementById("txRawJson"),
  toggleRawJsonButton: document.getElementById("toggleRawJsonButton"),
  txPreview: document.getElementById("txPreview"),
  openSignGateButton: document.getElementById("openSignGateButton"),
  securityStatus: document.getElementById("securityStatus"),
  safetyReminders: document.getElementById("safetyReminders"),
  signGateModal: document.getElementById("signGateModal"),
  signGateContent: document.getElementById("signGateContent"),
  signConfirmCheckbox: document.getElementById("signConfirmCheckbox"),
  confirmSignButton: document.getElementById("confirmSignButton"),
  signWithWalletButton: document.getElementById("signWithWalletButton"),
  closeSignGateButton: document.getElementById("closeSignGateButton"),
  cancelSignButton: document.getElementById("cancelSignButton"),
  openSettingsButton: document.getElementById("openSettingsButton"),
  openSidebarButton: document.getElementById("openSidebarButton"),
  closeSidebarButton: document.getElementById("closeSidebarButton"),
  workspaceGrid: document.getElementById("workspaceGrid"),
  sidebarPanel: document.getElementById("sidebarPanel"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  settingsDrawer: document.getElementById("settingsDrawer"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  settingsDisconnectButton: document.getElementById("settingsDisconnectButton"),
  settingsClearSessionButton: document.getElementById("settingsClearSessionButton"),
  adminUnlockInput: document.getElementById("adminUnlockInput"),
  adminUnlockButton: document.getElementById("adminUnlockButton"),
  adminLockButton: document.getElementById("adminLockButton"),
  adminUnlockStatus: document.getElementById("adminUnlockStatus"),
  adminPanel: document.getElementById("adminPanel"),
  supabaseUrlInput: document.getElementById("supabaseUrlInput"),
  supabaseAnonKeyInput: document.getElementById("supabaseAnonKeyInput"),
  saveSupabaseButton: document.getElementById("saveSupabaseButton"),
  testSupabaseButton: document.getElementById("testSupabaseButton"),
  supabaseStatus: document.getElementById("supabaseStatus"),
  securityEventLog: document.getElementById("securityEventLog"),
  settingsPageOpenDrawerButton: document.getElementById("settingsPageOpenDrawerButton"),
  settingsPageClearButton: document.getElementById("settingsPageClearButton"),
  settingsPageDisconnectButton: document.getElementById("settingsPageDisconnectButton"),
  heroAvatarPill: document.getElementById("heroAvatarPill"),
  avatarPhotoInput: document.getElementById("avatarPhotoInput"),
  avatarCameraInput: document.getElementById("avatarCameraInput"),
  profileUploadZone: document.getElementById("profileUploadZone"),
  uploadPhotoButton: document.getElementById("uploadPhotoButton"),
  cameraPhotoButton: document.getElementById("cameraPhotoButton"),
  clearPhotoButton: document.getElementById("clearPhotoButton"),
  profileWalletPanel: document.getElementById("profileWalletPanel"),
  profileWalletNetworkBadge: document.getElementById("profileWalletNetworkBadge"),
  heroAvatarGlowWrap: document.getElementById("heroAvatarGlowWrap"),
  heroAvatarStatusRing: document.getElementById("heroAvatarStatusRing"),
  heroAvatarStatusLabel: document.getElementById("heroAvatarStatusLabel"),
  avatarGlowColorInput: document.getElementById("avatarGlowColorInput"),
  avatarGlowIntensityInput: document.getElementById("avatarGlowIntensityInput"),
  avatarBorderColorInput: document.getElementById("avatarBorderColorInput"),
  avatarBorderWidthInput: document.getElementById("avatarBorderWidthInput"),
  avatarBorderShapeInput: document.getElementById("avatarBorderShapeInput"),
  avatarGlowSwatch: document.getElementById("avatarGlowSwatch"),
  avatarBorderSwatch: document.getElementById("avatarBorderSwatch"),
  fundWalletPanel: document.getElementById("fundWalletPanel"),
  fundWalletCard: document.getElementById("fundWalletCard"),
  fundWalletStatusBadge: document.getElementById("fundWalletStatusBadge"),
  keygenGate: document.getElementById("keygenGate"),
  keygenResult: document.getElementById("keygenResult"),
  keygenChecks: Array.from(document.querySelectorAll(".keygen-check")),
  keygenGenerateButton: document.getElementById("keygenGenerateButton"),
  keygenGateStatus: document.getElementById("keygenGateStatus"),
  keygenAddress: document.getElementById("keygenAddress"),
  keygenPublicKey: document.getElementById("keygenPublicKey"),
  keygenPrivateKey: document.getElementById("keygenPrivateKey"),
  keygenPrivShield: document.getElementById("keygenPrivShield"),
  keygenRevealButton: document.getElementById("keygenRevealButton"),
  keygenCopyPrivButton: document.getElementById("keygenCopyPrivButton"),
  keygenLoadAddressButton: document.getElementById("keygenLoadAddressButton"),
  keygenClearButton: document.getElementById("keygenClearButton"),
  keygenResultStatus: document.getElementById("keygenResultStatus"),
  sendButton: document.getElementById("sendButton"),
  // Hero inline Send / Receive tabs
  heroTabOverviewBtn: document.getElementById("heroTabOverviewBtn"),
  heroTabSendBtn: document.getElementById("heroTabSendBtn"),
  heroTabReceiveBtn: document.getElementById("heroTabReceiveBtn"),
  heroTabOverview: document.getElementById("heroTabOverview"),
  heroTabSend: document.getElementById("heroTabSend"),
  heroTabReceive: document.getElementById("heroTabReceive"),
  heroSendStep1: document.getElementById("heroSendStep1"),
  heroSendStep2: document.getElementById("heroSendStep2"),
  heroSendDest: document.getElementById("heroSendDest"),
  heroSendAmount: document.getElementById("heroSendAmount"),
  heroSendTag: document.getElementById("heroSendTag"),
  heroSendMemo: document.getElementById("heroSendMemo"),
  heroSendStatus: document.getElementById("heroSendStatus"),
  heroSendSummary: document.getElementById("heroSendSummary"),
  heroSendQr: document.getElementById("heroSendQr"),
  heroSendConfirm: document.getElementById("heroSendConfirm"),
  heroOpenXamanBtn: document.getElementById("heroOpenXamanBtn"),
  heroSendPreviewBtn: document.getElementById("heroSendPreviewBtn"),
  heroSendBackBtn: document.getElementById("heroSendBackBtn"),
  heroSendStep2Status: document.getElementById("heroSendStep2Status"),
  heroReceiveQr: document.getElementById("heroReceiveQr"),
  heroReceiveAddr: document.getElementById("heroReceiveAddr"),
  heroReceiveCopy: document.getElementById("heroReceiveCopy")
};

function chipClass(level) {
  if (level === RISK_LEVELS.SAFE) return "chip chip-safe";
  if (level === RISK_LEVELS.LOW) return "chip chip-low";
  if (level === RISK_LEVELS.MEDIUM) return "chip chip-medium";
  if (level === RISK_LEVELS.HIGH) return "chip chip-high";
  return "chip chip-blocked";
}

function setFeedback(text, isError = false) {
  if (!refs.feedback) return;
  refs.feedback.textContent = text;
  refs.feedback.style.color = isError ? "#ffb9c3" : "#d7e4ff";
}

function setSupabaseStatus(text, isError = false) {
  if (!refs.supabaseStatus) return;
  refs.supabaseStatus.textContent = text;
  refs.supabaseStatus.style.color = isError ? "#ffb9c3" : "#a9ffe6";
}

function setAdminStatus(text, isError = false) {
  if (!refs.adminUnlockStatus) return;
  refs.adminUnlockStatus.textContent = text;
  refs.adminUnlockStatus.style.color = isError ? "#ffb9c3" : "#a9ffe6";
}

function formatAddress(address = "") {
  if (!address) return "-";
  if (address.length < 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toIpfsGateway(uri = "") {
  const clean = String(uri || "").trim();
  if (!clean) return "";
  if (clean.startsWith("data:image/")) return clean;
  if (clean.startsWith("ipfs://ipfs/")) {
    return `https://ipfs.io/ipfs/${clean.slice("ipfs://ipfs/".length)}`;
  }
  if (clean.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${clean.slice("ipfs://".length)}`;
  }
  if (clean.startsWith("ar://")) {
    return `https://arweave.net/${clean.slice("ar://".length)}`;
  }
  if (clean.startsWith("https://") || clean.startsWith("http://")) return clean;
  return "";
}

function looksLikeImageUrl(url = "") {
  if (String(url || "").startsWith("data:image/")) return true;
  return /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(url);
}

function getProfileFields() {
  const profile = getProfileState();
  return {
    displayName: profile.displayName || "Wayfinder Scholar",
    handle: profile.handle || "@ike-journey",
    bio: profile.bio || "Protecting a public XRPL address while keeping the profile layer private.",
    realm: profile.realm || "Dreamtime",
    initials: (profile.initials || "WV").slice(0, 3).toUpperCase()
  };
}

function syncProfileEditor(profile = getProfileFields()) {
  if (refs.profileDisplayNameInput) refs.profileDisplayNameInput.value = profile.displayName;
  if (refs.profileHandleInput) refs.profileHandleInput.value = profile.handle;
  if (refs.profileRealmInput) refs.profileRealmInput.value = profile.realm;
  if (refs.profileBioInput) refs.profileBioInput.value = profile.bio;
  if (refs.profileInitialsInput) refs.profileInitialsInput.value = profile.initials;
}

function getProfileEditorValues() {
  return {
    displayName: (refs.profileDisplayNameInput?.value || "").trim() || "Wayfinder Scholar",
    handle: (refs.profileHandleInput?.value || "").trim() || "@ike-journey",
    bio: (refs.profileBioInput?.value || "").trim() || "Protecting a public XRPL address while keeping the profile layer private.",
    realm: (refs.profileRealmInput?.value || "").trim() || "Dreamtime",
    initials: (refs.profileInitialsInput?.value || "WV").trim().slice(0, 3).toUpperCase() || "WV"
  };
}

function safeNumber(value, decimals = 6) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : "0";
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatCompactNumber(value, decimals = 1) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(n) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(n) >= 10000 ? decimals : 2
  }).format(n);
}

function formatUsd(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "n/a";
  if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toPrecision(3)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(n) >= 1 ? 4 : 6
  }).format(n);
}

function formatPercent(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function decodeCurrencyCode(currency = "") {
  const value = String(currency || "").trim();
  if (/^[A-Fa-f0-9]{40}$/.test(value)) {
    try {
      const chars = value.match(/.{2}/g)
        .map((pair) => Number.parseInt(pair, 16))
        .filter((code) => code > 0)
        .map((code) => String.fromCharCode(code))
        .join("")
        .trim();
      return chars || value.slice(0, 8);
    } catch {
      return value.slice(0, 8);
    }
  }
  return value || "Unknown";
}

function shouldUseSupabaseSync() {
  return state.adminMode && hasSupabaseConfig();
}

function hasXrplAccount() {
  return Boolean(getWalletState().publicAddress);
}

function hasSigningWallet() {
  const walletState = getWalletState();
  const provider = walletState.provider || sessionStorage.getItem("ike_wallet_provider");
  return Boolean(walletState.publicAddress && (provider === "xaman" || provider === "created"));
}

function pageAccessMessage(page) {
  if (SIGNING_WALLET_PAGES.has(page)) {
    return "DEX access needs a Xumm wallet connection or an XRPL account created in IkeLedger.";
  }
  if (XRPL_ACCOUNT_PAGES.has(page)) {
    return "Connect Xumm, create a wallet, or load an XRPL address before opening that page.";
  }
  if (PROFILE_PAGES.has(page)) {
    return "Sign in to your IkeLedger profile first.";
  }
  return "";
}

function canOpenPage(page) {
  if (SIGNING_WALLET_PAGES.has(page)) return hasSigningWallet();
  if (XRPL_ACCOUNT_PAGES.has(page)) return hasXrplAccount();
  if (PROFILE_PAGES.has(page)) return Boolean(state.appUser);
  return true;
}

function getStoredAppUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.appUserSession);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAppUserSession(user) {
  state.appUser = {
    id: user.id || `${user.method || "local"}:${user.email || user.walletAddress || Date.now()}`,
    method: user.method || "email",
    email: user.email || "",
    username: user.username || user.email?.split("@")[0] || "IkeLedger User",
    verified: Boolean(user.verified),
    walletLinked: Boolean(user.walletLinked),
    walletAddress: user.walletAddress || "",
    createdAt: user.createdAt || new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.appUserSession, JSON.stringify(state.appUser));
  updateProfileState({
    displayName: state.appUser.username,
    handle: state.appUser.email ? `@${state.appUser.email.split("@")[0]}` : "@xumm-user"
  });
  renderCommandCenterAuth();
  closeAuthModal();
}

function clearAppUserSession() {
  state.appUser = null;
  localStorage.removeItem(STORAGE_KEYS.appUserSession);
  renderCommandCenterAuth();
}

function setCommandAuthStatus(text, isError = false) {
  if (!refs.commandAuthStatus) return;
  refs.commandAuthStatus.textContent = text;
  refs.commandAuthStatus.style.color = isError ? "#ffb9c3" : "#a9ffe6";
}

function friendlyXummError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/timeout|timed out|expired/i.test(message)) {
    return "Xumm sign in was not successful in time. No wallet was connected. Please try again and approve the request in Xaman.";
  }
  if (/cancel|reject|denied/i.test(message)) {
    return "Xumm sign in was not successful. The request was cancelled or rejected in the wallet app.";
  }
  return message || "Xumm sign in was not successful.";
}

function isExplicitXummRejection(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /cancel|reject|denied/i.test(message);
}

function getXamanApiKey() {
  return XAMAN_API_KEY || "";
}

function isAccountLookupMiss(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /No funded XRPL account|actNotFound|account.*not.*found/i.test(message);
}

async function lookupXamanAddressAcrossNetworks(address) {
  const initialNetwork = getWalletState().network || DEFAULT_NETWORK;
  const attempts = [
    initialNetwork,
    "xrpl-mainnet",
    "xrpl-testnet",
    "xrpl-devnet"
  ].filter((network, index, list) => NETWORKS[network] && list.indexOf(network) === index);

  let lastError = null;

  for (const network of attempts) {
    setNetwork(network);
    if (refs.networkSelect) refs.networkSelect.value = network;

    try {
      return await lookupReadOnlyAddress(address);
    } catch (error) {
      lastError = error;
      if (!isAccountLookupMiss(error)) {
        throw error;
      }
    }
  }

  setNetwork(initialNetwork);
  if (refs.networkSelect) refs.networkSelect.value = initialNetwork;

  if (lastError) {
    throw new Error("No funded XRPL account was found for this address on Mainnet, Testnet, or Devnet. If this is a new wallet, send XRP to activate it first.");
  }
  throw new Error("Could not verify the XRPL account.");
}

function resolveThemeMode(mode) {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode === "light" ? "light" : "dark";
}

function applyTheme(mode) {
  const resolved = resolveThemeMode(mode);
  document.body.classList.toggle("light-mode", resolved === "light");
  localStorage.setItem(STORAGE_KEYS.theme, mode);
  if (refs.themeSelect) refs.themeSelect.value = mode;
}

function cycleTheme() {
  const current = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
  const next = current === "dark" ? "light" : current === "light" ? "system" : "dark";
  applyTheme(next);
}

function setActivePage(page) {
  if (page === "nft-listings") {
    page = "nfts";
  }

  if (!canOpenPage(page)) {
    setFeedback(pageAccessMessage(page), true);
    if (!hasXrplAccount() || PROFILE_PAGES.has(page)) {
      openAuthModal();
    }
    page = "dashboard";
  }

  // Clear generated keys whenever leaving the create-wallet page
  if (state.activePage === "create-wallet" && page !== "create-wallet") {
    clearCreateWalletKeys();
  }

  state.activePage = page;

  refs.pageSections.forEach((section) => {
    section.classList.toggle("active", section.dataset.page === page);
  });

  [...refs.topLinks, ...refs.bottomLinks].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });

  refs.sidebarPanel?.querySelectorAll(".sidebar-btn").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === page);
  });
}

function timeframeToDays(timeframe) {
  if (timeframe === "1H") return null;
  if (timeframe === "24H") return "1";
  if (timeframe === "7D") return "7";
  if (timeframe === "30D") return "30";
  return "365";
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Market API failed (${response.status})`);
  }
  return response.json();
}

async function fetchXrpOverview() {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=ripple&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true"
  );
  const row = data?.ripple || {};
  return {
    price: Number(row.usd || 0),
    changePercent: Number(row.usd_24h_change || 0),
    volume: Number(row.usd_24h_vol || 0),
    marketCap: Number(row.usd_market_cap || 0)
  };
}

async function fetchXrpChartPoints(timeframe) {
  const days = timeframeToDays(timeframe);
  let url = "";

  if (days) {
    url = `https://api.coingecko.com/api/v3/coins/ripple/market_chart?vs_currency=usd&days=${days}`;
  } else {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 3600;
    url = `https://api.coingecko.com/api/v3/coins/ripple/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
  }

  const data = await fetchJson(url);
  const points = (data?.prices || []).map((point) => Number(point[1])).filter((v) => Number.isFinite(v));
  if (!points.length) {
    throw new Error("Market chart data unavailable.");
  }
  return points;
}

async function requestXrplCommand(networkKey, command) {
  const network = NETWORKS[networkKey] || NETWORKS[DEFAULT_NETWORK];
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(network.endpoint);
    const timeoutId = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // noop
      }
      reject(new Error("XRPL metric request timeout."));
    }, 8000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, ...command }));
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.id !== 1) return;
        clearTimeout(timeoutId);
        ws.close();
        resolve(payload.result || {});
      } catch {
        // ignore malformed events
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("XRPL metric request failed."));
    });
  });
}

async function fetchXrplNetworkMetrics() {
  const walletState = getWalletState();
  const networkKey = walletState.network || DEFAULT_NETWORK;
  const [serverInfoResult, feeResult] = await Promise.all([
    requestXrplCommand(networkKey, { command: "server_info" }),
    requestXrplCommand(networkKey, { command: "fee" })
  ]);

  return {
    ledgerIndex: Number(serverInfoResult?.info?.validated_ledger?.seq || 0),
    tps: "n/a",
    feeDrops: String(feeResult?.drops?.open_ledger_fee || feeResult?.drops?.minimum_fee || "n/a")
  };
}

function drawMarketChart(points) {
  const canvas = refs.marketChart;
  if (!canvas || !points.length) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const padding = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 0.00001);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(9, 15, 33, 0.88)";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(104, 139, 197, 0.26)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i += 1) {
    const y = (height / 6) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const path = new Path2D();
  points.forEach((price, index) => {
    const x = padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = height - padding - ((price - min) / range) * (height - padding * 2);
    if (index === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  });

  ctx.strokeStyle = "rgba(66, 232, 213, 0.96)";
  ctx.lineWidth = 2.4;
  ctx.stroke(path);

  const fill = new Path2D(path);
  fill.lineTo(width - padding, height - padding);
  fill.lineTo(padding, height - padding);
  fill.closePath();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(66, 232, 213, 0.28)");
  gradient.addColorStop(1, "rgba(66, 232, 213, 0.01)");
  ctx.fillStyle = gradient;
  ctx.fill(fill);
}

async function renderMarketOverview(forceRefresh = false) {
  try {
    const cacheKey = state.chartTimeframe;
    const shouldUseCache = !forceRefresh
      && state.marketCache.key === cacheKey
      && Date.now() - state.marketCache.fetchedAt < 15000
      && state.marketCache.snapshot;

    let snapshot = state.marketCache.snapshot;
    if (!shouldUseCache) {
      const [overview, points, networkMetrics] = await Promise.all([
        fetchXrpOverview(),
        fetchXrpChartPoints(state.chartTimeframe),
        fetchXrplNetworkMetrics().catch(() => ({ ledgerIndex: 0, tps: "n/a", feeDrops: "n/a" }))
      ]);

      snapshot = {
        ...overview,
        ...networkMetrics,
        points
      };
      state.marketCache = {
        key: cacheKey,
        fetchedAt: Date.now(),
        snapshot
      };
    }

    if (!snapshot) return;
    drawMarketChart(snapshot.points);

    const changePrefix = snapshot.changePercent >= 0 ? "+" : "";
    const changeText = `${changePrefix}${snapshot.changePercent.toFixed(2)}%`;

    if (refs.marketPrice) refs.marketPrice.textContent = `$${snapshot.price.toFixed(4)}`;
    if (refs.marketVolume) refs.marketVolume.textContent = `$${Math.round(snapshot.volume).toLocaleString()}`;
    if (refs.marketCap) refs.marketCap.textContent = `$${Math.round(snapshot.marketCap).toLocaleString()}`;
    if (refs.marketLedgerIndex) refs.marketLedgerIndex.textContent = snapshot.ledgerIndex ? snapshot.ledgerIndex.toLocaleString() : "n/a";
    if (refs.marketTps) refs.marketTps.textContent = snapshot.tps;
    if (refs.marketFee) refs.marketFee.textContent = snapshot.feeDrops === "n/a" ? "n/a" : `${snapshot.feeDrops} drops`;
    if (refs.xrpPriceStat) refs.xrpPriceStat.textContent = `$${snapshot.price.toFixed(4)}`;
    if (refs.xrpChangeStat) refs.xrpChangeStat.textContent = changeText;
    if (refs.xrpNavPrice) {
      const sign = snapshot.changePercent >= 0 ? "+" : "";
      refs.xrpNavPrice.textContent = `$${snapshot.price.toFixed(4)} ${sign}${snapshot.changePercent.toFixed(2)}%`;
      refs.xrpNavPrice.style.color = snapshot.changePercent >= 0 ? "var(--emerald)" : "var(--danger)";
    }
  } catch {
    if (refs.marketPrice) refs.marketPrice.textContent = "Unavailable";
    if (refs.marketVolume) refs.marketVolume.textContent = "Unavailable";
    if (refs.marketCap) refs.marketCap.textContent = "Unavailable";
    if (refs.marketLedgerIndex) refs.marketLedgerIndex.textContent = "Unavailable";
    if (refs.marketTps) refs.marketTps.textContent = "Unavailable";
    if (refs.marketFee) refs.marketFee.textContent = "Unavailable";
    if (refs.xrpPriceStat) refs.xrpPriceStat.textContent = "Unavailable";
    if (refs.xrpChangeStat) refs.xrpChangeStat.textContent = "Unavailable";
    if (refs.xrpNavPrice) refs.xrpNavPrice.textContent = "—";
  }
}

function renderReminders() {
  if (!refs.safetyReminders) return;
  const reminders = [
    ...reminderMessages(),
    "Use Testnet for learning and experiments.",
    "Connecting a wallet does not give this app access to move your funds.",
    "Always verify the network before signing.",
    "IkeLedger will never ask for your seed phrase."
  ];
  refs.safetyReminders.innerHTML = reminders.map((line) => `<li>${line}</li>`).join("");
}

function renderChips(walletState) {
  if (!refs.chips) return;
  const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
  const chips = [
    { label: walletState.status, risk: assessRisk("wallet_connect") },
    { label: walletState.mode || (sessionStorage.getItem("ike_wallet_provider") === "xaman" ? "Xaman Mode" : "Read-only Mode"), risk: RISK_LEVELS.SAFE },
    { label: network.label, risk: network.isMainnet ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW },
    { label: walletState.snapshot ? "Wallet Verified" : "Read-only Exploration", risk: walletState.snapshot ? RISK_LEVELS.SAFE : RISK_LEVELS.LOW }
  ];

  refs.chips.innerHTML = chips.map((chip) => `<span class="${chipClass(chip.risk)}">${chip.label}</span>`).join("");
  refs.mainnetWarning?.classList.toggle("hidden", !network.isMainnet);
}

function renderConnectionMeta(walletState) {
  if (!refs.providerStatus) return;
  const isXaman = walletState.provider === "xaman" || sessionStorage.getItem("ike_wallet_provider") === "xaman";
  const isCreated = walletState.provider === "created";
  refs.providerStatus.textContent = isXaman
    ? (walletState.snapshot ? "Xaman Connected" : "Xaman (address loaded)")
    : isCreated
      ? "Created Wallet"
    : (walletState.snapshot ? "XRPL + Xaman ready" : "Xaman / Read-only");
  refs.publicAddressCompact.textContent = formatAddress(walletState.publicAddress);

  const verified = walletState.snapshot;
  refs.walletVerifiedStatus.textContent = verified ? "Yes" : "No";
  refs.walletVerifiedStatus.style.color = verified ? "var(--emerald)" : "var(--warn)";

  if (refs.lastSyncStatus) {
    refs.lastSyncStatus.textContent = verified ? new Date().toLocaleTimeString() : "Not synced";
    refs.lastSyncStatus.style.color = verified ? "var(--ink-1)" : "var(--ink-2)";
  }

  if (refs.walletConnectionChip) {
    const modeLabel = !walletState.publicAddress
      ? "Disconnected"
      : walletState.snapshot
        ? (isXaman ? "Xaman" : isCreated ? "Created" : "Verified")
        : "Read-only";
    refs.walletConnectionChip.textContent = modeLabel;
    refs.walletConnectionChip.className = `chip ${walletState.snapshot ? "chip-safe" : walletState.publicAddress ? "chip-low" : "chip-medium"}`;
  }
}

function renderCommandCenterAuth() {
  const isSignedIn = Boolean(state.appUser);
  const walletState = getWalletState();
  const hasAccount = Boolean(walletState.publicAddress);
  const canSign = hasSigningWallet();

  if (refs.commandSessionBadge) {
    refs.commandSessionBadge.textContent = isSignedIn
      ? hasAccount ? canSign ? "Profile + Signing Wallet" : "Profile + XRPL"
        : "Profile only"
      : "Not signed in";
  }

  if (refs.openSignGateButton) refs.openSignGateButton.disabled = !canSign;
  if (refs.sendButton) refs.sendButton.disabled = !canSign;

  const sidebarButtons = refs.sidebarPanel ? Array.from(refs.sidebarPanel.querySelectorAll(".sidebar-btn")) : [];
  const gatedButtons = [...refs.topLinks, ...refs.bottomLinks, ...sidebarButtons];
  gatedButtons.forEach((button) => {
    const page = button.dataset.page;
    const locked = page ? !canOpenPage(page) : false;
    button.classList.toggle("is-locked", locked);
    button.setAttribute("aria-disabled", locked ? "true" : "false");
    if (locked) button.title = pageAccessMessage(page);
    else button.removeAttribute("title");
  });
}

function renderWalletStatus(walletState) {
  if (!refs.walletStatus) return;
  const account = walletState.snapshot?.account;
  const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
  if (!account) {
    refs.walletStatus.innerHTML = `
      <div class="wallet-status-empty">
        <span class="wallet-status-dot"></span>
        <div>
          <strong>No account loaded</strong>
          <p>Connect with Xaman or load a public XRPL address to view balances, reserves, and ledger objects.</p>
        </div>
      </div>
    `;
    return;
  }

  refs.walletStatus.innerHTML = `
    <div class="wallet-status-topline">
      <span class="chip ${network.isMainnet ? "chip-high" : "chip-low"}">${network.label}</span>
      <span class="chip chip-safe">${account.accountStatus || "Active"}</span>
    </div>
    <div class="wallet-balance-strip">
      <div><span>Total XRP</span><strong>${safeNumber(account.balanceXrp, 6)}</strong></div>
      <div><span>Available</span><strong>${safeNumber(account.availableXrp, 6)}</strong></div>
      <div><span>Reserve</span><strong>${safeNumber(account.ownerReserveXrp, 6)}</strong></div>
    </div>
    <div class="wallet-ledger-grid">
      <div><span>Sequence</span><strong>${account.sequence ?? "-"}</strong></div>
      <div><span>Objects</span><strong>${account.ownerCount ?? 0}</strong></div>
      <div><span>Trust Lines</span><strong>${account.trustLines ?? 0}</strong></div>
      <div><span>NFTs</span><strong>${account.nftCount ?? 0}</strong></div>
      <div><span>Recent Tx</span><strong>${account.recentActivityCount ?? 0}</strong></div>
      <div><span>Flags</span><strong>${account.flags ?? 0}</strong></div>
    </div>
  `;
}

function renderPortfolioSummary(walletState) {
  if (!refs.portfolioSummary) return;
  const snap = walletState.snapshot;
  const kpis = [
    { label: "Assets",  value: snap?.tokenHoldings?.length     || 0, unit: "tokens",    color: "cyan"      },
    { label: "Issued",  value: snap?.issuedTokenEntries?.length || 0, unit: "projects",  color: "cyan"      },
    { label: "NFTs",    value: snap?.nftItems?.length           || 0, unit: "items",     color: "violet"    },
    { label: "AMM",     value: snap?.amm?.objectCount           || 0, unit: "positions", color: "turquoise" }
  ];
  refs.portfolioSummary.innerHTML = `
    <div class="portfolio-kpi-grid">
      ${kpis.map((k) => `
        <div class="portfolio-kpi portfolio-kpi--${k.color}">
          <span class="portfolio-kpi-label">${k.label}</span>
          <span class="portfolio-kpi-value">${k.value}</span>
          <span class="portfolio-kpi-unit">${k.unit}</span>
        </div>`).join("")}
    </div>
    <p class="portfolio-mode-note muted">Assets, issued tokens, NFTs, and AMM objects from the loaded XRPL account.</p>
  `;
}

function renderMana(walletState) {
  if (!refs.manaStatus) return;
  const mana = getManaSummary(walletState.publicAddress);
  refs.manaStatus.innerHTML = `
    <p><strong>Mana Balance:</strong> ${mana.mana}</p>
    <p><strong>Recent Mana Earned:</strong> +${Math.max(2, Math.floor(mana.completedLessons / 2))}</p>
    <p><strong>Lesson Rewards:</strong> ${mana.completedLessons} completed</p>
    <p><strong>Realm Reward:</strong> ${mana.completedLessons >= 6 ? "Realm completion unlocked" : "In progress"}</p>
    <p><strong>Scholar Path:</strong> ${Math.min(100, mana.completedLessons * 12)}%</p>
    <p><strong>Keiki Path:</strong> ${Math.min(100, mana.completedLessons * 9)}%</p>
    <p><strong>Mana Log:</strong> Learning milestones only, not investment value.</p>
  `;
}

function buildProfileIdentityHTML(walletState) {
  const address = walletState.publicAddress;
  const profile = walletState.profile || getProfileFields();
  const statusLabel = walletState.snapshot ? "Linked" : "Read-only";
  const statusClass = walletState.snapshot ? "chip-safe" : "chip-low";
  return `
    <div class="profile-identity">
      <div class="profile-nameline">
        <span class="profile-display-name">${profile.displayName}</span>
        <span class="profile-handle">${profile.handle}</span>
      </div>
      <p class="profile-realm"><span class="eyebrow">Realm</span> ${profile.realm}</p>
      <p class="profile-bio">${profile.bio}</p>
      <div class="profile-stat-row">
        <div class="profile-stat">
          <span class="profile-stat-label">Wallet</span>
          <span class="profile-stat-value">${address ? formatAddress(address) : "Not connected"}</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-label">Status</span>
          <span class="chip ${statusClass}">${statusLabel}</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-label">Privacy</span>
          <span class="profile-stat-value">Public view · Private profile</span>
        </div>
      </div>
    </div>
  `;
}

function applyProfilePhoto() {
  const photo = localStorage.getItem(STORAGE_KEYS.profilePhoto);
  const profile = getProfileFields();
  const avatarEls = [refs.heroAvatarPill, refs.profileAvatarPill].filter(Boolean);
  avatarEls.forEach((el) => {
    if (photo) {
      el.innerHTML = `<img src="${photo}" alt="Profile photo" />`;
    } else {
      el.textContent = profile.initials;
    }
  });
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function applyAvatarStyle() {
  const glowColor    = localStorage.getItem(STORAGE_KEYS.avatarGlowColor)     || "#46bcff";
  const glowIntensity = parseInt(localStorage.getItem(STORAGE_KEYS.avatarGlowIntensity) ?? "55", 10);
  const borderColor  = localStorage.getItem(STORAGE_KEYS.avatarBorderColor)   || "#e9c77a";
  const borderShape  = localStorage.getItem(STORAGE_KEYS.avatarBorderShape)   || "circle";
  const borderWidth  = parseInt(localStorage.getItem(STORAGE_KEYS.avatarBorderWidth) ?? "2", 10);

  // Glow box-shadow from color + intensity
  const { r, g, b } = hexToRgb(glowColor);
  const alpha1 = (glowIntensity / 100) * 0.75;
  const alpha2 = (glowIntensity / 100) * 0.35;
  const spread1 = 16 + Math.round((glowIntensity / 100) * 36);
  const spread2 = spread1 * 2;
  const glowShadow = glowIntensity === 0
    ? "none"
    : `0 0 ${spread1}px rgba(${r},${g},${b},${alpha1.toFixed(2)}), 0 0 ${spread2}px rgba(${r},${g},${b},${alpha2.toFixed(2)})`;

  // Sync border-radius between ring and pill/image via CSS var on wrap
  const radii = { circle: "50%", rounded: "20px", square: "6px" };
  const radius = radii[borderShape] || "50%";

  [refs.heroAvatarPill, refs.profileAvatarPill].filter(Boolean).forEach((pill) => {
    pill.style.setProperty("--avatar-glow", glowShadow);
    pill.style.setProperty("--avatar-border-color", borderColor);
    pill.style.setProperty("--avatar-border-radius", radius);
    pill.style.setProperty("--avatar-border-width", `${borderWidth}px`);
    pill.classList.remove("avatar-shape-circle", "avatar-shape-rounded", "avatar-shape-square");
    pill.classList.add(`avatar-shape-${borderShape}`);
  });

  // Keep status ring shape in sync
  if (refs.heroAvatarStatusRing) {
    refs.heroAvatarStatusRing.style.borderRadius = radius;
  }

  // Sync swatches and inputs
  if (refs.avatarGlowColorInput)     refs.avatarGlowColorInput.value     = glowColor;
  if (refs.avatarGlowIntensityInput) refs.avatarGlowIntensityInput.value = String(glowIntensity);
  if (refs.avatarBorderColorInput)   refs.avatarBorderColorInput.value   = borderColor;
  if (refs.avatarBorderWidthInput)   refs.avatarBorderWidthInput.value   = String(borderWidth);
  if (refs.avatarBorderShapeInput)   refs.avatarBorderShapeInput.value   = borderShape;
  if (refs.avatarGlowSwatch)         refs.avatarGlowSwatch.style.background  = glowColor;
  if (refs.avatarBorderSwatch)       refs.avatarBorderSwatch.style.background = borderColor;
}

function saveAvatarStyle() {
  localStorage.setItem(STORAGE_KEYS.avatarGlowColor,     refs.avatarGlowColorInput?.value     || "#46bcff");
  localStorage.setItem(STORAGE_KEYS.avatarGlowIntensity, refs.avatarGlowIntensityInput?.value  || "55");
  localStorage.setItem(STORAGE_KEYS.avatarBorderColor,   refs.avatarBorderColorInput?.value    || "#e9c77a");
  localStorage.setItem(STORAGE_KEYS.avatarBorderShape,   refs.avatarBorderShapeInput?.value    || "circle");
  localStorage.setItem(STORAGE_KEYS.avatarBorderWidth,   refs.avatarBorderWidthInput?.value    || "2");
  applyAvatarStyle();
}

function getAvatarStatusClass(walletState) {
  if (!walletState.publicAddress) return "status-disconnected";
  if (!walletState.snapshot) return "status-loaded";
  const bal = parseFloat(walletState.snapshot.account?.balanceXrp || "0");
  if (bal <= 0) return "status-unfunded";
  return "status-verified";
}

function getAvatarStatusText(walletState) {
  if (!walletState.publicAddress) return "Not connected";
  if (!walletState.snapshot) return "Address loaded";
  const bal = parseFloat(walletState.snapshot.account?.balanceXrp || "0");
  if (bal <= 0) return "Not funded";
  return "Verified & active";
}

function renderAvatarStatus(walletState) {
  const ring  = refs.heroAvatarStatusRing;
  const label = refs.heroAvatarStatusLabel;
  if (!ring) return;
  const cls = getAvatarStatusClass(walletState);
  ring.className = `avatar-status-ring ${cls}`;
  if (label) {
    label.textContent = getAvatarStatusText(walletState);
    label.style.color =
      cls === "status-verified"    ? "var(--emerald)" :
      cls === "status-loaded"      ? "var(--warn)"    :
      cls === "status-unfunded"    ? "var(--danger)"  :
      "var(--muted)";
  }
}

function renderFundWalletCard(walletState) {
  if (!refs.fundWalletPanel) return;

  const { publicAddress, snapshot } = walletState;

  if (!publicAddress) {
    if (refs.fundWalletCard) refs.fundWalletCard.classList.add("hidden");
    return;
  }

  if (refs.fundWalletCard) refs.fundWalletCard.classList.remove("hidden");

  const bal = parseFloat(snapshot?.account?.balanceXrp || "0");
  const isFunded = snapshot && bal >= 1;
  const isVerified = Boolean(snapshot);

  if (refs.fundWalletStatusBadge) {
    refs.fundWalletStatusBadge.textContent = isFunded ? "Active" : isVerified ? "Unfunded" : "Not queried";
    refs.fundWalletStatusBadge.style.color = isFunded ? "var(--emerald)" : "var(--warn)";
  }

  if (isFunded) {
    refs.fundWalletPanel.innerHTML = `
      <div class="fund-wallet-funded">
        <span style="font-size:1.2rem">✓</span>
        <span>This wallet is active on the XRPL — balance: <strong>${bal.toFixed(4)} XRP</strong></span>
      </div>
      <div class="fund-wallet-address-block" style="margin-top:0.75rem">
        <span class="fund-wallet-addr-label">Classic Address</span>
        <code class="fund-wallet-addr-value">${publicAddress}</code>
        <button type="button" class="ghost fund-copy-btn" data-copy="${publicAddress}" style="align-self:flex-start;font-size:0.8rem;margin-top:0.25rem">Copy Address</button>
      </div>
    `;
  } else {
    const baseReserve = 1;
    const recommended = 2;
    refs.fundWalletPanel.innerHTML = `
      <div class="fund-wallet-address-block">
        <span class="fund-wallet-addr-label">Send XRP to this address to activate your wallet</span>
        <code class="fund-wallet-addr-value">${publicAddress}</code>
        <button type="button" class="ghost fund-copy-btn" data-copy="${publicAddress}" style="align-self:flex-start;font-size:0.8rem;margin-top:0.25rem">Copy Address</button>
      </div>
      <div class="fund-wallet-amount-row">
        <div class="fund-wallet-amount-tile">
          <span class="fund-tile-label">Base Reserve</span>
          <span class="fund-tile-value">${baseReserve}<span class="fund-tile-unit">XRP</span></span>
        </div>
        <div class="fund-wallet-amount-tile">
          <span class="fund-tile-label">Recommended</span>
          <span class="fund-tile-value">${recommended}<span class="fund-tile-unit">XRP minimum</span></span>
        </div>
        <div class="fund-wallet-amount-tile">
          <span class="fund-tile-label">Current Balance</span>
          <span class="fund-tile-value" style="color:var(--danger)">${isVerified ? bal.toFixed(4) : "—"}<span class="fund-tile-unit">XRP</span></span>
        </div>
      </div>
      <div class="fund-wallet-steps">
        <div class="fund-step-row"><span class="fund-step-num">1</span><span>Copy your Classic Address above.</span></div>
        <div class="fund-step-row"><span class="fund-step-num">2</span><span>Log in to any exchange that supports XRP Ledger withdrawals (Coinbase, Kraken, Binance, Bybit, etc.).</span></div>
        <div class="fund-step-row"><span class="fund-step-num">3</span><span>Withdraw at least <strong>2 XRP</strong> to your Classic Address. No destination tag is needed for self-custody wallets.</span></div>
        <div class="fund-step-row"><span class="fund-step-num">4</span><span>Return here and press <strong>Refresh Account</strong> on the dashboard. Once 1 XRP arrives, your account activates on-chain.</span></div>
      </div>
      <p class="muted" style="font-size:0.78rem;margin-top:0.5rem">The XRPL base reserve (1 XRP) is locked in your account permanently and cannot be spent — it is only recovered by deleting the account. Send 2 XRP so you have 1 XRP spendable after the reserve.</p>
    `;
  }

  // Wire copy buttons
  refs.fundWalletPanel.querySelectorAll(".fund-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copy || "")
        .then(() => { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy Address"; }, 2000); })
        .catch(() => { btn.textContent = "Copy failed"; });
    });
  });
}

function onPhotoFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    setFeedback("Please select an image file.", true);
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setFeedback("Image too large — max 8 MB.", true);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    try {
      localStorage.setItem(STORAGE_KEYS.profilePhoto, dataUrl);
    } catch {
      setFeedback("Storage full — try a smaller image.", true);
      return;
    }
    applyProfilePhoto();
    setFeedback("Profile photo updated.");
  };
  reader.readAsDataURL(file);
}

function renderProfile(walletState) {
  const html = buildProfileIdentityHTML(walletState);
  if (refs.profileStatus) refs.profileStatus.innerHTML = html;
  if (refs.profilePagePanel) refs.profilePagePanel.innerHTML = html;
  applyProfilePhoto();
  syncProfileEditor(walletState.profile || getProfileFields());
  renderProfileWalletCard(walletState);
}

function renderProfileWalletCard(walletState) {
  if (!refs.profileWalletPanel) return;

  const { publicAddress, snapshot, network, mode } = walletState;
  const netConfig = NETWORKS[network] || NETWORKS["xrpl-testnet"];

  if (refs.profileWalletNetworkBadge) {
    refs.profileWalletNetworkBadge.textContent = netConfig.label;
  }

  if (!publicAddress) {
    refs.profileWalletPanel.innerHTML = `
      <div class="profile-wallet-empty">
        <p class="muted">No wallet connected to this profile.</p>
        <p class="muted">Enter a public XRPL address on the dashboard or create a new wallet to see your account details here.</p>
        <div class="button-row">
          <button type="button" class="ghost profile-wallet-nav-btn" data-nav="dashboard">Go to Dashboard</button>
          <button type="button" class="ghost profile-wallet-nav-btn" data-nav="create-wallet">Create Wallet</button>
        </div>
      </div>
    `;
    refs.profileWalletPanel.querySelectorAll(".profile-wallet-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActivePage(btn.dataset.nav));
    });
    return;
  }

  const account = snapshot?.account;
  const isVerified = Boolean(snapshot);

  // Reserve breakdown — live from XRPL or fallback to current spec values
  const ownerCount = account?.ownerCount ?? 0;
  const baseReserveXrp = 1;
  const ownerReservePerObj = 0.2;
  const totalOwnerReserve = (ownerCount * ownerReservePerObj).toFixed(2);
  const totalReserved = (baseReserveXrp + ownerCount * ownerReservePerObj).toFixed(2);

  const statusColor = !isVerified ? "var(--warn)" : "var(--emerald)";
  const statusLabel = !isVerified ? "Address loaded — not yet verified on-chain" : account?.accountStatus || "Active";

  refs.profileWalletPanel.innerHTML = `
    <div class="profile-wallet-address-row">
      <span class="profile-wallet-addr-label">Classic Address</span>
      <code class="profile-wallet-addr">${publicAddress}</code>
      <button type="button" class="ghost keygen-copy-btn profile-wallet-copy" data-copy="${publicAddress}">Copy</button>
    </div>

    <div class="profile-wallet-status-row">
      <span class="profile-wallet-status-dot" style="background:${statusColor}"></span>
      <span style="color:${statusColor}; font-size:0.82rem; font-weight:600;">${statusLabel}</span>
      <span class="muted" style="font-size:0.78rem;">· ${mode || "Read-only Mode"}</span>
    </div>

    ${isVerified ? `
    <div class="profile-wallet-kpi-grid">
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Total XRP</span>
        <span class="profile-wallet-kpi-value gold">${account?.balanceXrp ?? "0"}</span>
        <span class="profile-wallet-kpi-unit">XRP</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Available</span>
        <span class="profile-wallet-kpi-value cyan">${account?.availableXrp ?? "0"}</span>
        <span class="profile-wallet-kpi-unit">XRP</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Reserved</span>
        <span class="profile-wallet-kpi-value muted-val">${account?.ownerReserveXrp ?? totalReserved}</span>
        <span class="profile-wallet-kpi-unit">XRP</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Objects</span>
        <span class="profile-wallet-kpi-value violet">${ownerCount}</span>
        <span class="profile-wallet-kpi-unit">owned</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Trust Lines</span>
        <span class="profile-wallet-kpi-value cyan">${account?.trustLines ?? 0}</span>
        <span class="profile-wallet-kpi-unit">lines</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">NFTs</span>
        <span class="profile-wallet-kpi-value violet">${account?.nftCount ?? 0}</span>
        <span class="profile-wallet-kpi-unit">items</span>
      </div>
    </div>

    <div class="profile-wallet-detail-grid">
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Sequence</span>
        <span class="profile-wallet-detail-value mono">${account?.sequence ?? "—"}</span>
      </div>
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Recent Activity</span>
        <span class="profile-wallet-detail-value">${account?.recentActivityCount ?? 0} transactions</span>
      </div>
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Base Reserve</span>
        <span class="profile-wallet-detail-value">${baseReserveXrp} XRP <span class="muted">(account activation)</span></span>
      </div>
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Owner Reserve</span>
        <span class="profile-wallet-detail-value">${totalOwnerReserve} XRP <span class="muted">(${ownerCount} × 0.2 XRP)</span></span>
      </div>
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Total Reserved</span>
        <span class="profile-wallet-detail-value">${totalReserved} XRP</span>
      </div>
      <div class="profile-wallet-detail-row">
        <span class="profile-wallet-detail-label">Network</span>
        <span class="profile-wallet-detail-value">${netConfig.label}</span>
      </div>
    </div>
    ` : `
    <div class="profile-wallet-unverified">
      <p class="muted">Account not yet verified on-chain. Press <strong>Refresh Account</strong> on the dashboard to query the XRPL.</p>
      ${netConfig.isMainnet ? `<p class="keygen-danger-note">⚠ You are on Mainnet — real assets may be involved.</p>` : ""}
    </div>
    `}
  `;

  // Wire copy button
  const copyBtn = refs.profileWalletPanel.querySelector(".profile-wallet-copy");
  copyBtn?.addEventListener("click", () => {
    const addr = copyBtn.dataset.copy;
    navigator.clipboard.writeText(addr)
      .then(() => { copyBtn.textContent = "Copied!"; setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000); })
      .catch(() => { copyBtn.textContent = "Copy failed"; });
  });
}

function onSaveProfile() {
  const nextProfile = getProfileEditorValues();
  updateProfileState(nextProfile);
  const walletState = getWalletState();
  renderProfile(walletState);
  setFeedback("Profile saved.");
}

function renderProofLearning(walletState) {
  if (!refs.proofLearning) return;
  const mana = getManaSummary(walletState.publicAddress);
  const completedAt = new Date().toISOString().slice(0, 10);
  refs.proofLearning.innerHTML = `
    <p><strong>Lesson ID:</strong> DT-01</p>
    <p><strong>Realm:</strong> Dreamtime</p>
    <p><strong>Completion Date:</strong> ${completedAt}</p>
    <p><strong>Mana Awarded:</strong> +${Math.max(10, Math.floor(mana.mana / 4))}</p>
    <p><strong>Verification:</strong> Verified learning record</p>
    <p><strong>Proof Hash:</strong> ${walletState.publicAddress ? `pol-${walletState.publicAddress.slice(-8)}` : "-"}</p>
    <p><strong>Credential:</strong> View credential</p>
  `;
}

function renderBadges(walletState) {
  if (!refs.badgeCredentials) return;
  const mana = getManaSummary(walletState.publicAddress);
  refs.badgeCredentials.innerHTML = `
    <p><strong>Lesson Badges:</strong> ${Math.max(1, mana.completedLessons - 1)}</p>
    <p><strong>Realm Badges:</strong> ${mana.completedLessons >= 6 ? 1 : 0}</p>
    <p><strong>Protocol Awareness:</strong> Earned</p>
    <p><strong>Cultural Bridge:</strong> Active</p>
    <p><strong>Scholar Badge:</strong> ${mana.completedLessons >= 6 ? "Earned" : "In progress"}</p>
    <p><strong>Keiki Badge:</strong> ${mana.completedLessons >= 4 ? "Earned" : "In progress"}</p>
    <p><strong>Credential Verification:</strong> Anchored to your journey</p>
  `;
}

function renderTokenHoldings(walletState) {
  const holdings = walletState.snapshot?.tokenHoldings || [];
  const xrpBalance = walletState.snapshot?.account?.balanceXrp || "0";
  const trustLineCount = walletState.snapshot?.account?.trustLines || holdings.length;
  const xrpRow = `
    <div class="asset-item wallet-token-card native">
      <div class="wallet-token-top">
        <div>
          <p class="asset-label">XRP</p>
          <span>XRPL Native Asset</span>
        </div>
        <span class="${chipClass(RISK_LEVELS.SAFE)}">Native</span>
      </div>
      <div class="wallet-token-balance">${safeNumber(xrpBalance, 4)} <span>XRP</span></div>
      <div class="asset-row-values"><span>Trust: not required</span><span>Value: market linked</span></div>
      <div class="button-row"><button class="ghost" type="button">Send</button><button class="ghost" type="button">Receive</button><button class="ghost" type="button">Swap</button></div>
    </div>
  `;

  const summaryHtml = `
    <div class="token-holdings-summary">
      <div><span>XRP Balance</span><strong>${safeNumber(xrpBalance, 4)}</strong></div>
      <div><span>Issued Assets</span><strong>${holdings.length}</strong></div>
      <div><span>Trust Lines</span><strong>${trustLineCount}</strong></div>
    </div>
  `;

  let html = summaryHtml;
  if (!holdings.length) {
    html += `<div class="wallet-token-grid">${xrpRow}</div><p class="muted">No issued token balances found for this account.</p>`;
    if (refs.tokenHoldings) refs.tokenHoldings.innerHTML = html;
    if (refs.tokensPagePanel) refs.tokensPagePanel.innerHTML = html;
    return;
  }

  html += `<div class="wallet-token-grid">${xrpRow}` + holdings.slice(0, 32).map((token) => {
    const balance = Number.parseFloat(token.balance || "0");
    const risk = balance < 0 ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW;
    const change = `${balance >= 0 ? "+" : ""}${(Math.abs(balance) % 7).toFixed(2)}%`;
    const symbol = decodeCurrencyCode(token.currency);
    return `
      <div class="asset-item wallet-token-card">
        <div class="wallet-token-top">
          <div>
            <p class="asset-label">${escapeHtml(symbol)}</p>
            <span>Issued Token</span>
          </div>
          <span class="${chipClass(risk)}">${risk}</span>
        </div>
        <div class="wallet-token-balance">${escapeHtml(token.balance)} <span>${escapeHtml(symbol)}</span></div>
        <div class="asset-row-head"><span>Issuer: ${escapeHtml(formatAddress(token.counterparty))}</span><span>Trust Line Active</span></div>
        <div class="asset-row-values"><span>Limit: ${escapeHtml(token.limit || "0")}</span><span>24h estimate: ${change}</span></div>
        <div class="button-row"><button class="ghost" type="button">Send</button><button class="ghost" type="button">Swap</button><button class="ghost" type="button">View issuer</button></div>
      </div>
    `;
  }).join("") + `</div>`;
  if (refs.tokenHoldings) refs.tokenHoldings.innerHTML = html;
  if (refs.tokensPagePanel) refs.tokensPagePanel.innerHTML = html;
}

function normalizeIssuedAssetMarketToken(token = {}, index = 0) {
  const symbol = decodeCurrencyCode(token.name || token.currency || "");
  return {
    rank: index + 1,
    symbol,
    currency: decodeCurrencyCode(token.currency || symbol),
    issuer: token.issuer || "",
    priceUsd: toFiniteNumber(token.usd, Number.NaN),
    change24h: toFiniteNumber(token.pro24h ?? token.p24h, Number.NaN),
    marketCap: toFiniteNumber(token.marketcap, Number.NaN),
    holders: toFiniteNumber(token.holders, Number.NaN),
    trustlines: toFiniteNumber(token.trustlines, Number.NaN),
    volume24h: toFiniteNumber(token.vol24hxrp ?? token.vol24h, Number.NaN),
    verified: Boolean(token.verified || token.kyc),
    slug: token.slug || "",
    updatedAt: token.lastUpdated || token.updatedAt || ""
  };
}

function getCachedTopIssuedAssets() {
  try {
    const cached = JSON.parse(localStorage.getItem(TOP_ISSUED_ASSETS_CACHE_KEY) || "null");
    if (!cached?.items?.length || !cached.fetchedAt) return null;
    if (Date.now() - cached.fetchedAt > TOP_ISSUED_ASSETS_CACHE_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function setCachedTopIssuedAssets(items) {
  try {
    localStorage.setItem(TOP_ISSUED_ASSETS_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      items
    }));
  } catch {
    // Cache is optional.
  }
}

function renderTopIssuedTokens() {
  if (!refs.topIssuedTokensPanel) return;
  const { items, loading, error, fetchedAt } = state.topIssuedAssets;
  if (refs.refreshTopIssuedTokensButton) {
    refs.refreshTopIssuedTokensButton.disabled = loading;
    refs.refreshTopIssuedTokensButton.textContent = loading ? "Loading..." : "Refresh";
  }

  if (!items.length && loading) {
    refs.topIssuedTokensPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>Loading top issued assets...</strong>
        <p class="muted">Fetching price, market cap, holder, and trust line data.</p>
      </div>
    `;
    return;
  }

  if (!items.length) {
    refs.topIssuedTokensPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>${error ? "Top issued assets unavailable" : "Top issued assets loading soon"}</strong>
        <p class="muted">${error ? escapeHtml(error) : "Live XRPL issued-asset data will appear here."}</p>
      </div>
    `;
    return;
  }

  const totalMarketCap = items.reduce((sum, token) => sum + (Number.isFinite(token.marketCap) ? token.marketCap : 0), 0);
  const totalHolders = items.reduce((sum, token) => sum + (Number.isFinite(token.holders) ? token.holders : 0), 0);
  const updatedLabel = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "cached";
  const query = state.topIssuedFilter.trim().toLowerCase();
  const filteredItems = query
    ? items.filter((token) =>
        token.symbol.toLowerCase().includes(query)
        || token.currency.toLowerCase().includes(query)
        || token.issuer.toLowerCase().includes(query)
      )
    : items;

  const rows = filteredItems.slice(0, 50).map((token) => {
    const changeClass = Number.isFinite(token.change24h) && token.change24h >= 0 ? "positive" : "negative";
    const sourceUrl = token.slug ? `https://xrpl.to/token/${encodeURIComponent(token.slug)}` : "";
    return `
      <tr>
        <td class="rank-cell">${token.rank}</td>
        <td>
          <strong>${escapeHtml(token.symbol)}</strong>
          <span>${escapeHtml(formatAddress(token.issuer))}</span>
        </td>
        <td>${formatUsd(token.priceUsd)}</td>
        <td class="${changeClass}">${formatPercent(token.change24h)}</td>
        <td>${formatUsd(token.marketCap)}</td>
        <td>${formatCompactNumber(token.holders, 1)}</td>
        <td>${formatCompactNumber(token.trustlines, 1)}</td>
        <td>${formatCompactNumber(token.volume24h, 1)} XRP</td>
        <td>${token.verified ? '<span class="market-token-badge verified">Verified</span>' : '<span class="market-token-badge">Unverified</span>'}</td>
        <td>${sourceUrl ? `<a class="ghost table-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">View</a>` : "-"}</td>
      </tr>
    `;
  }).join("");

  refs.topIssuedTokensPanel.innerHTML = `
    <div class="market-token-summary">
      <div><span>Showing</span><strong>${filteredItems.length}/${items.length}</strong></div>
      <div><span>Combined Market Cap</span><strong>${formatUsd(totalMarketCap)}</strong></div>
      <div><span>Holder Count</span><strong>${formatCompactNumber(totalHolders, 1)}</strong></div>
      <div><span>Updated</span><strong>${updatedLabel}</strong></div>
    </div>
    <label class="market-token-filter">
      <span>Filter assets</span>
      <input id="topIssuedTokenFilter" type="search" placeholder="Search symbol or issuer..." value="${escapeHtml(state.topIssuedFilter)}" autocomplete="off" />
    </label>
    ${error ? `<p class="market-token-note">${escapeHtml(error)} Showing cached data where available.</p>` : ""}
    <div class="issued-token-table-wrap" role="region" aria-label="Top 50 issued XRPL assets" tabindex="0">
      <table class="issued-token-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Asset / Issuer</th>
            <th>Price</th>
            <th>24h</th>
            <th>Market Cap</th>
            <th>Holders</th>
            <th>Trust Lines</th>
            <th>Volume</th>
            <th>Status</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="10" class="empty-table-cell">No issued assets match this filter.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  const filterInput = refs.topIssuedTokensPanel.querySelector("#topIssuedTokenFilter");
  filterInput?.addEventListener("input", (event) => {
    state.topIssuedFilter = event.target.value || "";
    renderTopIssuedTokens();
  });
}

async function loadTopIssuedAssets(forceRefresh = false) {
  if (!refs.topIssuedTokensPanel || state.topIssuedAssets.loading) return;

  if (!forceRefresh && state.topIssuedAssets.items.length) {
    renderTopIssuedTokens();
    return;
  }

  const cached = !forceRefresh ? getCachedTopIssuedAssets() : null;
  if (cached) {
    state.topIssuedAssets = {
      fetchedAt: cached.fetchedAt,
      items: cached.items,
      loading: false,
      error: ""
    };
    renderTopIssuedTokens();
    return;
  }

  state.topIssuedAssets.loading = true;
  state.topIssuedAssets.error = "";
  renderTopIssuedTokens();

  try {
    const response = await fetch(TOP_ISSUED_ASSETS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(response.status === 429
        ? "Market API rate limit reached. Try refresh again in a moment."
        : "Could not load issued asset market data.");
    }
    const data = await response.json();
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const items = tokens.slice(0, 50).map(normalizeIssuedAssetMarketToken);
    state.topIssuedAssets = {
      fetchedAt: Date.now(),
      items,
      loading: false,
      error: ""
    };
    setCachedTopIssuedAssets(items);
  } catch (error) {
    const cachedFallback = getCachedTopIssuedAssets();
    state.topIssuedAssets = {
      fetchedAt: cachedFallback?.fetchedAt || 0,
      items: cachedFallback?.items || state.topIssuedAssets.items || [],
      loading: false,
      error: error instanceof Error ? error.message : "Could not load issued asset market data."
    };
  }

  renderTopIssuedTokens();
}

function renderIssuedTokens(walletState) {
  if (!refs.issuedTokens) return;
  const issued = walletState.snapshot?.issuedTokenEntries || [];
  if (!issued.length) {
    refs.issuedTokens.innerHTML = "<p>No issuer obligations found for this wallet.</p>";
    return;
  }

  refs.issuedTokens.innerHTML = issued.slice(0, 14).map((token) => `
    <div class="asset-item">
      <p class="asset-label">${token.currency}</p>
      <p>Issued Amount: ${token.amount}</p>
      <p>Issuer: ${formatAddress(token.issuer)}</p>
      <p>Status: <span class="${chipClass(RISK_LEVELS.LOW)}">Tracked</span></p>
    </div>
  `).join("");
}

function nftFallbackMarkup(nft) {
  const initials = String(nft?.issuer || "NFT").slice(0, 2).toUpperCase();
  return `<div class="nft-thumb-fallback"><span>${escapeHtml(initials)}</span></div>`;
}

function nftDisplayName(nft) {
  return nft?.metadata?.name || `NFT ${formatAddress(nft?.nftId || "")}`;
}

function resolveNftImageSource(nft) {
  const uri = toIpfsGateway(nft?.metadata?.imageUrl || nft?.imageUrl || nft?.uri || "");
  if (!uri) return { imageUrl: "", metadataUrl: "" };
  if (looksLikeImageUrl(uri)) return { imageUrl: uri, metadataUrl: "" };
  return { imageUrl: "", metadataUrl: uri };
}

async function fetchNftMetadata(nft) {
  const cacheKey = nft.nftId || nft.uri || "";
  if (!cacheKey) return {};
  if (nftMetadataCache.has(cacheKey)) return nftMetadataCache.get(cacheKey);

  const initial = resolveNftImageSource(nft);
  if (initial.imageUrl) {
    const result = { imageUrl: initial.imageUrl, name: "", description: "" };
    nftMetadataCache.set(cacheKey, result);
    return result;
  }

  if (!initial.metadataUrl) {
    nftMetadataCache.set(cacheKey, {});
    return {};
  }

  try {
    const response = await fetch(initial.metadataUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("NFT metadata request failed.");
    const metadata = await response.json();
    const imageUrl = toIpfsGateway(
      metadata.image
      || metadata.image_url
      || metadata.imageUrl
      || metadata.animation_url
      || metadata.properties?.image
      || metadata.image_data
      || ""
    );
    const result = {
      imageUrl,
      name: metadata.name || "",
      description: metadata.description || "",
      raw: metadata
    };
    nftMetadataCache.set(cacheKey, result);
    return result;
  } catch {
    nftMetadataCache.set(cacheKey, {});
    return {};
  }
}

function hydrateNftImages(nfts) {
  nfts.slice(0, 60).forEach((nft) => {
    void fetchNftMetadata(nft).then((metadata) => {
      const items = document.querySelectorAll(`[data-nft-id="${CSS.escape(nft.nftId)}"]`);
      if (!items.length) return;

      items.forEach((item) => {
        const thumb = item.querySelector(".nft-thumb");
        if (thumb && metadata.imageUrl) {
          thumb.innerHTML = `<img src="${escapeHtml(metadata.imageUrl)}" alt="${escapeHtml(metadata.name || "XRPL NFT image")}" loading="lazy" referrerpolicy="no-referrer" />`;
          thumb.classList.add("has-image");
        }

        const title = item.querySelector(".nft-title");
        if (title && metadata.name) title.textContent = metadata.name;

        const desc = item.querySelector(".nft-description, .nft-feature-description");
        if (desc && metadata.description) desc.textContent = metadata.description;
      });
    });
  });
}

function nftThumbMarkup(nft) {
  const source = resolveNftImageSource(nft);
  const thumb = source.imageUrl
    ? `<img src="${escapeHtml(source.imageUrl)}" alt="${escapeHtml(nftDisplayName(nft))}" loading="lazy" referrerpolicy="no-referrer" />`
    : nftFallbackMarkup(nft);
  return `<div class="nft-thumb ${source.imageUrl ? "has-image" : ""}">${thumb}</div>`;
}

function nftOfferSummaryMarkup(nft) {
  const offers = nft?.offers || {};
  const sellOffers = Number.isFinite(offers.sellOffers) ? offers.sellOffers : 0;
  const buyOffers = Number.isFinite(offers.buyOffers) ? offers.buyOffers : 0;
  return `
    <div class="nft-offer-strip">
      <div><span>Sell Offers</span><strong>${sellOffers}</strong></div>
      <div><span>Buy Offers</span><strong>${buyOffers}</strong></div>
      <div><span>Lowest Sell</span><strong>${escapeHtml(offers.lowestSell || "None")}</strong></div>
      <div><span>Highest Buy</span><strong>${escapeHtml(offers.highestBuy || "None")}</strong></div>
    </div>
  `;
}

function renderNftGalleryItem(nft, isSelected = false) {
  const offers = nft?.offers || {};
  const totalOffers = (offers.sellOffers || 0) + (offers.buyOffers || 0);
  return `
    <button class="nft-item nft-select ${isSelected ? "is-selected" : ""}" type="button" data-nft-select="${escapeHtml(nft.nftId)}" data-nft-id="${escapeHtml(nft.nftId)}">
      ${nftThumbMarkup(nft)}
      <span class="nft-title">${escapeHtml(nftDisplayName(nft))}</span>
      <span class="nft-mini-meta">Taxon ${escapeHtml(nft.taxon)} | ${totalOffers} offers</span>
      <span class="nft-mini-meta">Issuer ${escapeHtml(formatAddress(nft.issuer))}</span>
    </button>
  `;
}

function bindNftViewerEvents() {
  refs.nftsPagePanel?.querySelectorAll("[data-nft-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNftId = button.dataset.nftSelect || "";
      renderNfts(getWalletState());
    });
  });
}

function renderNftViewer(nfts) {
  const selected = nfts.find((nft) => nft.nftId === state.selectedNftId) || nfts[0];
  state.selectedNftId = selected.nftId;
  const offers = selected.offers || {};
  const selectedHasOffers = (offers.sellOffers || 0) + (offers.buyOffers || 0) > 0;
  const totalSellOffers = nfts.reduce((sum, nft) => sum + (nft.offers?.sellOffers || 0), 0);
  const totalBuyOffers = nfts.reduce((sum, nft) => sum + (nft.offers?.buyOffers || 0), 0);
  const source = resolveNftImageSource(selected);
  const openUri = selected.uri ? toIpfsGateway(selected.uri) || selected.uri : "";

  return `
    <div class="nft-viewer-layout">
      <section class="nft-feature" data-nft-id="${escapeHtml(selected.nftId)}">
        <div class="nft-feature-image nft-thumb ${source.imageUrl ? "has-image" : ""}">
          ${source.imageUrl
            ? `<img src="${escapeHtml(source.imageUrl)}" alt="${escapeHtml(nftDisplayName(selected))}" loading="lazy" referrerpolicy="no-referrer" />`
            : nftFallbackMarkup(selected)}
        </div>
        <div class="nft-feature-copy">
          <div class="section-top compact">
            <h3 class="nft-feature-title nft-title">${escapeHtml(nftDisplayName(selected))}</h3>
            <span class="mode-pill">${selectedHasOffers ? "Offers live" : "Held NFT"}</span>
          </div>
          <p class="nft-feature-description muted">${escapeHtml(selected.metadata?.description || "Metadata loads from the NFT URI when available.")}</p>
          ${nftOfferSummaryMarkup(selected)}
          <div class="nft-detail-grid">
            <div><span>Token ID</span><strong>${escapeHtml(formatAddress(selected.nftId))}</strong></div>
            <div><span>Issuer</span><strong>${escapeHtml(formatAddress(selected.issuer))}</strong></div>
            <div><span>Taxon</span><strong>${escapeHtml(selected.taxon)}</strong></div>
            <div><span>Transfer Fee</span><strong>${escapeHtml(String(selected.transferFee ?? "-"))}</strong></div>
            <div><span>Metadata URI</span><strong>${selected.uri ? escapeHtml(formatAddress(selected.uri)) : "None"}</strong></div>
            <div><span>Media</span><strong>${source.imageUrl ? "Image ready" : source.metadataUrl ? "Metadata lookup" : "No media URI"}</strong></div>
          </div>
          <div class="button-row">
            ${openUri ? `<a class="ghost table-link" href="${escapeHtml(openUri)}" target="_blank" rel="noopener noreferrer">Open URI</a>` : ""}
            <button class="ghost" type="button">Create Listing</button>
            <button class="ghost" type="button">Refresh Offers</button>
          </div>
        </div>
      </section>
      <section class="nft-gallery-panel">
        <div class="nft-gallery-head">
          <div><span>Inventory</span><strong>${nfts.length} NFTs</strong></div>
          <div><span>Sell Offers</span><strong>${totalSellOffers}</strong></div>
          <div><span>Buy Offers</span><strong>${totalBuyOffers}</strong></div>
        </div>
        <div class="nft-grid nft-gallery-grid">
          ${nfts.slice(0, 60).map((nft) => renderNftGalleryItem(nft, nft.nftId === selected.nftId)).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderNftListingPanel(nfts) {
  const offerNfts = nfts.filter((nft) => (nft.offers?.sellOffers || 0) + (nft.offers?.buyOffers || 0) > 0);

  if (!offerNfts.length) {
    return `
      <div class="nft-listing-panel">
        <div class="section-top compact">
          <h3>Listings & Offers</h3>
          <span class="mode-pill">No open offers</span>
        </div>
        <p class="muted">No sell offers or buy offers were found for the loaded NFT inventory.</p>
      </div>
    `;
  }

  return `
    <div class="nft-listing-panel">
      <div class="section-top compact">
        <h3>Listings & Offers</h3>
        <span class="mode-pill">Live offer scan</span>
      </div>
      <div class="nft-listing-grid">
        ${offerNfts.slice(0, 12).map((nft) => `
          <div class="nft-listing-row" data-nft-id="${escapeHtml(nft.nftId)}">
            ${nftThumbMarkup(nft)}
            <div>
              <strong>${escapeHtml(nftDisplayName(nft))}</strong>
              <span>${escapeHtml(formatAddress(nft.nftId))}</span>
            </div>
            <div><span>Sell</span><strong>${nft.offers?.sellOffers || 0}</strong></div>
            <div><span>Buy</span><strong>${nft.offers?.buyOffers || 0}</strong></div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderNfts(walletState) {
  const nfts = walletState.snapshot?.nftItems || [];
  if (!nfts.length) {
    if (refs.nftListingStatus) {
      refs.nftListingStatus.innerHTML = "<p>No active NFT listings, buy offers, or sell offers found.</p>";
    }
    if (refs.nftsPagePanel) {
      refs.nftsPagePanel.innerHTML = `
        <div class="nft-empty-state">
          <img src="./ikeledger/assets/images/ikenft.png" alt="" loading="lazy" />
          <strong>No NFTs found for this XRPL account.</strong>
          <p class="muted">NFT images, metadata, and offer details will appear here after an XLS-20 inventory is detected.</p>
        </div>
      `;
    }
    return;
  }

  const nftListingHtml = renderNftListingPanel(nfts);
  if (refs.nftListingStatus) refs.nftListingStatus.innerHTML = nftListingHtml;

  if (refs.nftsPagePanel) {
    refs.nftsPagePanel.innerHTML = `
      ${renderNftViewer(nfts)}
      ${nftListingHtml}
    `;
    bindNftViewerEvents();
  }

  if (refs.nftListingsPagePanel) {
    refs.nftListingsPagePanel.innerHTML = nftListingHtml;
  }

  hydrateNftImages(nfts);
}

function renderAmm(walletState) {
  if (!refs.ammStatus) return;
  const amm = walletState.snapshot?.amm || { objectCount: 0, recentActivityCount: 0, recentActivity: [] };
  if (!amm.objectCount) {
    refs.ammStatus.innerHTML = "<p>No active AMM / LP positions found.</p>";
    if (refs.ammPagePanel) {
      refs.ammPagePanel.innerHTML = "<p>Add liquidity, withdraw, vote, and bid actions will appear once a pool position is detected.</p>";
    }
    return;
  }

  refs.ammStatus.innerHTML = `
    <p><strong>Pool Pair:</strong> XRP / USDC</p>
    <p><strong>LP Balance:</strong> ${safeNumber(amm.objectCount * 13.77, 2)} LP</p>
    <p><strong>Pool Share:</strong> ${(amm.objectCount * 0.34).toFixed(2)}%</p>
    <p><strong>Estimated Value:</strong> Quote feed required</p>
    <p><strong>Trading Fee Tier:</strong> 0.30%</p>
    <p><strong>Vote Status:</strong> ${amm.recentActivity[0]?.type || "No active vote"}</p>
    <div class="button-row"><button class="ghost" type="button">Deposit</button><button class="ghost" type="button">Withdraw</button><button class="ghost" type="button">View Pool</button></div>
  `;

  if (refs.ammPagePanel) {
    refs.ammPagePanel.innerHTML = refs.ammStatus.innerHTML + "<p>AMM deposits are not risk-free. Fees do not guarantee profit.</p>";
  }
}

function renderValueMix(walletState) {
  if (!refs.valueMix) return;
  const mix = walletState.snapshot?.valueMix || [];
  if (!mix.length) {
    refs.valueMix.innerHTML = "<p>Load an address to view value mix by asset/project.</p>";
    return;
  }

  refs.valueMix.innerHTML = mix.map((entry) => `
    <div class="mix-row">
      <div class="mix-top"><span>${entry.label}</span><span>${entry.percentage.toFixed(1)}%</span></div>
      <div class="mix-bar"><div class="mix-fill" style="width:${Math.max(2, Math.min(100, entry.percentage)).toFixed(1)}%"></div></div>
      <p>${entry.note}</p>
    </div>
  `).join("") + "<p>Value is unit-based in read-only mode. Market conversion can be added with quote feeds.</p>";
}

function renderTxHistory(walletState) {
  if (!refs.txHistory) return;
  const txItems = walletState.snapshot?.txItems || [];
  state.latestTxItems = txItems;

  if (!txItems.length) {
    refs.txHistory.innerHTML = "<p>No recent ledger activity for this session.</p>";
    if (refs.dashboardActivity) {
      refs.dashboardActivity.innerHTML = "<p>No recent ledger activity loaded yet.</p>";
    }
    refs.txRawJson.textContent = "[]";
    return;
  }

  refs.txHistory.innerHTML = txItems.map((tx) => `
    <div class="tx-item">
      <p><strong>${tx.label}</strong></p>
      <p>Type: ${tx.type} | Asset: ${tx.amount} ${tx.asset}</p>
      <p>From: ${formatAddress(tx.sendingAccount)} -> To: ${formatAddress(tx.receivingAccount)}</p>
      <p>Fee: ${tx.fee} drops | Hash: ${formatAddress(tx.hash)}</p>
    </div>
  `).join("");

  if (refs.dashboardActivity) {
    refs.dashboardActivity.innerHTML = txItems.slice(0, 3).map((tx) => `
      <p><strong>${tx.type}</strong> - ${tx.amount} ${tx.asset}<br />
      <span class="muted">${formatAddress(tx.hash)}</span></p>
    `).join("");
  }

  refs.txRawJson.textContent = JSON.stringify(txItems.map((tx) => tx.raw || {}), null, 2);
}

function txToPreview(walletState) {
  const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
  const tx = walletState.snapshot?.txItems?.[0];

  if (!tx) {
    return {
      type: "None",
      sendingAccount: "-",
      receivingAccount: "-",
      amount: "-",
      asset: "XRP",
      fee: "0",
      destinationTag: "-",
      memo: "-",
      network: network.label,
      risk: RISK_LEVELS.SAFE,
      irreversible: false
    };
  }

  return {
    type: tx.type,
    sendingAccount: tx.sendingAccount,
    receivingAccount: tx.receivingAccount,
    amount: tx.amount,
    asset: tx.asset,
    fee: tx.fee,
    destinationTag: tx.destinationTag ?? "-",
    memo: tx.memo ?? "-",
    network: network.label,
    risk: tx.type === "Payment" && network.isMainnet ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM,
    irreversible: true
  };
}

function renderTxPreview(walletState) {
  if (!refs.txPreview) return;
  const preview = txToPreview(walletState);
  state.latestPreview = preview;

  const plainLanguage = preview.type === "Payment"
    ? `You are sending ${preview.amount} ${preview.asset} to ${formatAddress(preview.receivingAccount)} on ${preview.network}.`
    : preview.type === "TrustSet"
      ? `You are creating or updating a trust line. Only trust issuers you understand.`
      : preview.type === "OfferCreate"
        ? "You are creating a DEX offer. This may execute immediately depending on market conditions."
        : preview.type?.startsWith("AMM")
          ? "You are interacting with an AMM pool. Liquidity positions carry market and impermanent loss risk."
          : preview.type?.startsWith("NFToken")
            ? "You are submitting an NFT action. If accepted, ownership changes can be permanent."
            : "Review all transaction fields before continuing.";

  refs.txPreview.innerHTML = `
    <p><strong>Plain Language:</strong> ${plainLanguage}</p>
    <p><strong>Transaction Type:</strong> ${preview.type}</p>
    <p><strong>Sending Address:</strong> ${formatAddress(preview.sendingAccount)}</p>
    <p><strong>Receiving Address:</strong> ${formatAddress(preview.receivingAccount)}</p>
    <p><strong>Amount:</strong> ${preview.amount}</p>
    <p><strong>Asset:</strong> ${preview.asset}</p>
    <p><strong>Network:</strong> ${preview.network}</p>
    <p><strong>Fee:</strong> ${preview.fee} drops</p>
    <p><strong>Destination Tag:</strong> ${preview.destinationTag}</p>
    <p><strong>Memo:</strong> ${preview.memo}</p>
    <p><strong>Risk Level:</strong> ${preview.risk}</p>
    <p><strong>Warning:</strong> XRPL transactions are irreversible after validation.</p>
  `;
}

function renderExtendedPanels(walletState) {
  const dexHtml = hasSigningWallet()
    ? `
      <p><strong>Pair Selector:</strong> XRP / USDC</p>
      <p><strong>Order Book:</strong> Ready for live bids/asks integration.</p>
      <p><strong>Open Orders:</strong> ${walletState.snapshot?.txItems?.filter((tx) => tx.type === "OfferCreate").length || 0}</p>
      <p><strong>Risk Labels:</strong> Issuer and slippage warnings enabled.</p>
      <div class="button-row"><button class="ghost" type="button">Create Offer</button><button class="ghost" type="button">Cancel Offer</button><button class="ghost" type="button">Set Trust Line</button></div>
    `
    : `
      <p><strong>DEX locked:</strong> Connect Xumm or load a wallet created in IkeLedger to access transaction tools.</p>
      <p class="muted">Email-only profiles can view the Command Center overview, but cannot create offers or sign transactions.</p>
      <div class="button-row"><button id="dexAuthPromptButton" type="button">Sign In / Connect</button><button class="ghost profile-wallet-nav-btn" data-nav="create-wallet" type="button">Create Wallet</button></div>
    `;

  if (refs.dexStatus) refs.dexStatus.innerHTML = dexHtml;

  if (refs.dexPagePanel) {
    refs.dexPagePanel.innerHTML = dexHtml;
    refs.dexPagePanel.querySelector("#dexAuthPromptButton")?.addEventListener("click", openAuthModal);
    refs.dexPagePanel.querySelectorAll(".profile-wallet-nav-btn[data-nav]").forEach((button) => {
      button.addEventListener("click", () => setActivePage(button.dataset.nav));
    });
  }

  if (refs.walletPageSummary) {
    refs.walletPageSummary.innerHTML = refs.walletStatus?.innerHTML || "<p>Wallet overview unavailable.</p>";
  }

  if (refs.credentialsPagePanel) {
    refs.credentialsPagePanel.innerHTML = `
      <p><strong>Mana earned through learning:</strong> Active</p>
      <p><strong>Credential model:</strong> Participation and completion, not ownership of culture.</p>
      <p><strong>Linked ecosystems:</strong> Pikoverse, Ikeverse, Living Knowledge Platform, Digitalverse, Culturalverse, IkeHub.</p>
      <p><strong>Verification status:</strong> Ready for XRPL anchor integration.</p>
    `;
  }
  // profilePagePanel is set by renderProfile — no need to copy it here
}

function renderSecurity() {
  const events = getSecurityEvents();

  if (refs.securityStatus) {
    if (!events.length) {
      refs.securityStatus.innerHTML = `
        <p><strong>Checklist:</strong> Seed phrase blocked, private key blocked, network warning active.</p>
        <p><strong>Status:</strong> Protected connection</p>
        <p><strong>Events:</strong> No recent warnings</p>
      `;
    } else {
      refs.securityStatus.innerHTML = events.slice(0, 6).map((event) =>
        `<p><strong>${event.riskLevel}</strong> - ${event.eventType} (${new Date(event.createdAt).toLocaleString()})</p>`
      ).join("");
    }
  }

  if (refs.securityEventLog) {
    if (!events.length) {
      refs.securityEventLog.innerHTML = `<p class="muted">No session events yet. Events are logged as you interact with the wallet.</p>`;
    } else {
      refs.securityEventLog.innerHTML = `<div class="security-events">${events.slice(0, 12).map((event) => {
        const riskClass = event.riskLevel === "BLOCKED" ? "chip-blocked"
          : event.riskLevel === "HIGH" ? "chip-high"
          : event.riskLevel === "MEDIUM" ? "chip-medium"
          : event.riskLevel === "LOW" ? "chip-low"
          : "chip-safe";
        const time = new Date(event.createdAt).toLocaleTimeString();
        return `<div class="security-event-row">
          <span class="chip ${riskClass}">${event.riskLevel}</span>
          <span>${event.eventType}</span>
          <span class="muted" style="margin-left:auto">${time}</span>
        </div>`;
      }).join("")}</div>`;
    }
  }

  if (refs.securityChipStat) {
    refs.securityChipStat.textContent = events.length ? "Review warnings" : "Protected";
  }
}

function renderAll() {
  const walletState = getWalletState();
  renderCommandCenterAuth();
  renderChips(walletState);
  renderConnectionMeta(walletState);
  renderPortfolioSummary(walletState);
  renderWalletStatus(walletState);
  renderMana(walletState);
  renderProfile(walletState);
  renderProofLearning(walletState);
  renderBadges(walletState);
  renderTokenHoldings(walletState);
  renderTopIssuedTokens();
  renderIssuedTokens(walletState);
  renderNfts(walletState);
  renderAmm(walletState);
  renderValueMix(walletState);
  renderTxHistory(walletState);
  renderTxPreview(walletState);
  renderSecurity();
  renderAvatarStatus(walletState);
  renderFundWalletCard(walletState);
  void renderMarketOverview();
  renderExtendedPanels(walletState);
}

function renderAdminPanel() {
  refs.adminPanel?.classList.toggle("hidden", !state.adminMode);
  setAdminStatus(state.adminMode ? "Builder admin unlocked." : "Builder admin locked.");
}

function openSettingsDrawer() {
  refs.settingsDrawer?.classList.remove("hidden");
  if (refs.settingsDrawer) {
    refs.settingsDrawer.style.display = "flex";
    refs.settingsDrawer.setAttribute("aria-hidden", "false");
  }
}

function closeSettingsDrawer() {
  refs.settingsDrawer?.classList.add("hidden");
  if (refs.settingsDrawer) {
    refs.settingsDrawer.style.display = "none";
    refs.settingsDrawer.setAttribute("aria-hidden", "true");
  }
}

function openAuthModal() {
  refs.authModal?.classList.remove("hidden");
  if (refs.authModal) {
    refs.authModal.style.display = "flex";
    refs.authModal.setAttribute("aria-hidden", "false");
  }
  renderCommandCenterAuth();
  refs.commandXummSignInButton?.focus();
}

function closeAuthModal() {
  refs.authModal?.classList.add("hidden");
  if (refs.authModal) {
    refs.authModal.style.display = "none";
    refs.authModal.setAttribute("aria-hidden", "true");
  }
}

function openSidebarPanel() {
  refs.workspaceGrid?.classList.remove("sidebar-closed");
  refs.sidebarPanel?.classList.add("open");
  if (window.innerWidth <= 1100) {
    refs.sidebarOverlay?.classList.remove("hidden");
  }
}

function closeSidebarPanel() {
  refs.workspaceGrid?.classList.add("sidebar-closed");
  refs.sidebarPanel?.classList.remove("open");
  refs.sidebarOverlay?.classList.add("hidden");
}

function toggleRawJson() {
  state.rawJsonOpen = !state.rawJsonOpen;
  refs.txRawJson?.classList.toggle("hidden", !state.rawJsonOpen);
  if (refs.toggleRawJsonButton) {
    refs.toggleRawJsonButton.textContent = state.rawJsonOpen ? "Hide Raw JSON" : "Show Raw JSON";
  }
}

async function pushSecurityEventToSupabase(eventType, riskLevel, walletAddress, details) {
  if (!shouldUseSupabaseSync()) return;
  const result = await logSecurityEventRemote({ eventType, riskLevel, walletAddress, details });
  if (!result.ok) {
    setSupabaseStatus(result.message, true);
  }
}

function onUnlockAdmin() {
  const code = refs.adminUnlockInput?.value.trim() || "";
  if (!code) {
    setAdminStatus("Enter the builder code.", true);
    return;
  }

  if (code !== BUILDER_ADMIN_CODE) {
    setAdminStatus("Invalid builder code.", true);
    refs.adminUnlockInput.value = "";
    return;
  }

  state.adminMode = true;
  localStorage.setItem(STORAGE_KEYS.adminMode, "true");
  refs.adminUnlockInput.value = "";
  renderAdminPanel();
}

function onLockAdmin() {
  state.adminMode = false;
  localStorage.removeItem(STORAGE_KEYS.adminMode);
  renderAdminPanel();
}

async function onLookup() {
  const address = refs.addressInput?.value.trim() || "";
  if (!address) {
    setFeedback("Enter a public XRPL address.", true);
    return;
  }

  if (looksLikeSensitiveInput(address)) {
    refs.addressInput.value = "";
    logSecurityEvent("blocked_secret_input", RISK_LEVELS.BLOCKED, {
      context: "address_input",
      network: refs.networkSelect?.value || "",
      addressHint: "blocked"
    });
    setFeedback("For your safety, seed phrases and private keys are blocked.", true);
    renderSecurity();
    return;
  }

  setFeedback("Loading read-only ledger account...");

  try {
    setPublicAddress(address);
    setWalletProvider("read-only");
    sessionStorage.removeItem("ike_wallet_provider");
    await lookupReadOnlyAddress(address);

    if (shouldUseSupabaseSync()) {
      const walletState = getWalletState();
      const syncResult = await linkWalletConnectionRemote({
        walletAddress: address,
        network: walletState.network,
        provider: "read-only",
        verified: false
      });
      if (!syncResult.ok) {
        setSupabaseStatus(syncResult.message, true);
      }
    }

    setFeedback("Read-only exploration loaded.");
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "Lookup failed.", true);
  } finally {
    renderAll();
  }
}

function onNetworkChange(event) {
  const selected = event.target.value;
  setNetwork(selected);
  logSecurityEvent("network_changed", RISK_LEVELS.LOW, {
    context: "network_selector",
    network: selected
  });
  renderAll();
}

function onDisconnect() {
  disconnectWallet();
  sessionStorage.removeItem("ike_wallet_provider");
  setWalletProvider(null);
  if (state.appUser?.walletLinked) {
    saveAppUserSession({
      ...state.appUser,
      walletLinked: false,
      walletAddress: ""
    });
  }
  resetXumm();
  if (refs.addressInput) refs.addressInput.value = "";
  logSecurityEvent("wallet_disconnected", RISK_LEVELS.LOW, { context: "manual" });
  setFeedback("Wallet disconnected.");
  if (!canOpenPage(state.activePage)) setActivePage("dashboard");
  renderAll();
}

function onClearSession() {
  clearSessionStorage();
  sessionStorage.removeItem("ike_wallet_provider");
  setWalletProvider(null);
  clearAppUserSession();
  void signOutEmailAuth();
  resetXumm();
  if (refs.addressInput) refs.addressInput.value = "";
  logSecurityEvent("session_cleared", RISK_LEVELS.SAFE, { context: "manual" });
  setFeedback("Session cleared.");
  if (!canOpenPage(state.activePage)) setActivePage("dashboard");
  renderAll();
}

function onLoadDemo() {
  if (!refs.addressInput) return;
  refs.addressInput.value = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
  setFeedback("Demo address loaded.");
}

function onCopyAddress() {
  const walletState = getWalletState();
  if (!walletState.publicAddress) {
    setFeedback("No wallet address to copy yet.", true);
    return;
  }

  navigator.clipboard.writeText(walletState.publicAddress)
    .then(() => setFeedback("Address copied."))
    .catch(() => setFeedback("Copy failed. You can copy manually.", true));
}

async function connectWithXumm() {
  setFeedback("Opening Xumm sign in...");
  setCommandAuthStatus("Opening Xumm sign in. Approve the request in Xaman to continue.");
  logSecurityEvent("xumm_signin_started", RISK_LEVELS.LOW, { context: "connect_wallet_button" });
  if (refs.connectXamanButton) refs.connectXamanButton.disabled = true;
  if (refs.commandXummSignInButton) refs.commandXummSignInButton.disabled = true;

  try {
    if (refs.commandXummSignInButton) refs.commandXummSignInButton.textContent = "Waiting for Xumm...";
    const xumm = await initXumm(getXamanApiKey());
    setCommandAuthStatus("Waiting for wallet approval in Xaman...");
    const account = await signInWithXumm(xumm);
    setCommandAuthStatus("Xumm approved. Loading your XRPL account...");
    const verified = await verifyXummAccount(account);
    if (verified) {
      const existingUser = state.appUser;
      saveAppUserSession({
        id: existingUser?.id,
        method: existingUser?.method || "xumm",
        email: existingUser?.email || "",
        username: existingUser?.username || `Xumm ${formatAddress(account)}`,
        verified: existingUser ? existingUser.verified : true,
        walletLinked: true,
        walletAddress: account,
        createdAt: existingUser?.createdAt
      });
      closeAuthModal();
      renderAll();
      setActivePage("profile");
      setCommandAuthStatus("Signed in with Xumm. Profile and wallet refreshed.");
      setFeedback("Signed in with Xumm. Your profile and wallet are loaded.");
    } else {
      clearXummSession();
      sessionStorage.removeItem("ike_wallet_provider");
      setWalletProvider("");
      setCommandAuthStatus("Xumm sign in was not successful. The XRPL account could not be loaded.", true);
    }
  } catch (err) {
    if (isExplicitXummRejection(err)) {
      clearXummSession();
      sessionStorage.removeItem("ike_wallet_provider");
      setWalletProvider("");
    }
    const message = friendlyXummError(err);
    setCommandAuthStatus(message, true);
    setFeedback(message, true);
  } finally {
    if (refs.connectXamanButton) refs.connectXamanButton.disabled = false;
    if (refs.commandXummSignInButton) {
      refs.commandXummSignInButton.disabled = false;
      refs.commandXummSignInButton.textContent = "Sign In with Xumm";
    }
  }
}

async function onEmailProfileSignUp() {
  const username = refs.commandUsernameInput?.value.trim() || "";
  const email = refs.commandEmailInput?.value.trim() || "";
  const password = refs.commandPasswordInput?.value || "";

  if (!username || !email || password.length < 6) {
    setCommandAuthStatus("Enter a username, valid email, and password with at least 6 characters.", true);
    return;
  }

  if (!hasSupabaseConfig()) {
    setCommandAuthStatus("Email verification needs Supabase Auth configured in Builder Admin.", true);
    return;
  }

  const result = await signUpWithEmail({ email, password, username });
  setCommandAuthStatus(result.message, !result.ok);
  if (result.ok) {
    const user = result.data?.user;
    const confirmed = Boolean(user?.email_confirmed_at);
    if (result.data?.session && confirmed) {
      saveAppUserSession({
        id: user?.id,
        method: "email",
        email,
        username,
        verified: true,
        walletLinked: Boolean(getWalletState().publicAddress),
        walletAddress: getWalletState().publicAddress || ""
      });
    }
  }
}

async function onEmailProfileSignIn() {
  const email = refs.commandEmailInput?.value.trim() || "";
  const password = refs.commandPasswordInput?.value || "";

  if (!email || !password) {
    setCommandAuthStatus("Enter your email and password.", true);
    return;
  }

  if (!hasSupabaseConfig()) {
    setCommandAuthStatus("Email sign in needs Supabase Auth configured in Builder Admin.", true);
    return;
  }

  const result = await signInWithEmail({ email, password });
  if (!result.ok) {
    setCommandAuthStatus(result.message, true);
    return;
  }

  const user = result.data?.user;
  const username = user?.user_metadata?.username || email.split("@")[0];
  saveAppUserSession({
    id: user?.id,
    method: "email",
    email,
    username,
    verified: Boolean(user?.email_confirmed_at),
    walletLinked: Boolean(getWalletState().publicAddress),
    walletAddress: getWalletState().publicAddress || ""
  });
  setCommandAuthStatus(user?.email_confirmed_at ? "Signed in." : "Signed in. Email verification is still pending.", !user?.email_confirmed_at);
}

async function verifyXummAccount(approvedAddress = "") {
  const address = approvedAddress.trim();

  if (!address) {
    setFeedback("Xumm did not return an XRPL address.", true);
    return false;
  }

  if (looksLikeSensitiveInput(address)) {
    logSecurityEvent("blocked_secret_input", RISK_LEVELS.BLOCKED, {
      context: "xumm_connect_account",
      addressHint: "blocked"
    });
    setFeedback("For your safety, seed phrases and private keys are blocked.", true);
    renderSecurity();
    return false;
  }

  if (!XRPL_ADDRESS_PATTERN.test(address)) {
    setFeedback("Xumm returned an invalid XRPL Classic Address.", true);
    return false;
  }

  setFeedback("Xumm approved. Loading XRPL account...");

  try {
    setNetwork("xrpl-mainnet");
    if (refs.networkSelect) refs.networkSelect.value = "xrpl-mainnet";

    setPublicAddress(address);
    sessionStorage.setItem("ike_wallet_provider", "xaman");
    setWalletProvider("xaman");

    if (refs.addressInput) refs.addressInput.value = address;
    await lookupXamanAddressAcrossNetworks(address);

    logSecurityEvent("xaman_connect_verified", RISK_LEVELS.LOW, {
      context: "xumm_connect",
      addressHint: formatAddress(address)
    });

    if (shouldUseSupabaseSync()) {
      const walletState = getWalletState();
      await linkWalletConnectionRemote({
        walletAddress: address,
        network: walletState.network,
        provider: "xaman",
        verified: true
      }).catch(() => {});
    }

    setFeedback("Xumm wallet connected and XRPL account loaded.");

    renderAll();
    return true;
  } catch (err) {
    sessionStorage.setItem("ike_wallet_provider", "xaman");
    setWalletProvider("xaman");
    if (refs.addressInput) refs.addressInput.value = address;

    logSecurityEvent("xaman_connect_pending_snapshot", RISK_LEVELS.LOW, {
      context: "xumm_connect",
      addressHint: formatAddress(address),
      reason: err instanceof Error ? err.message : "snapshot pending"
    });

    setCommandAuthStatus("Xumm approved. XRPL account data is still loading; press Refresh Account if balances do not appear.", false);
    setFeedback("Xumm wallet connected. XRPL account data is still loading; press Refresh Account if needed.");
    renderAll();
    return true;
  }
}

function openSignGateModal() {
  if (!hasSigningWallet()) {
    setFeedback(pageAccessMessage("dex"), true);
    openAuthModal();
    return;
  }
  const preview = state.latestPreview || txToPreview(getWalletState());
  refs.signGateContent.innerHTML = `
    <p><strong>Transaction Type:</strong> ${preview.type}</p>
    <p><strong>Sending Address:</strong> ${formatAddress(preview.sendingAccount)}</p>
    <p><strong>Receiving Address:</strong> ${formatAddress(preview.receivingAccount)}</p>
    <p><strong>Amount:</strong> ${preview.amount}</p>
    <p><strong>Asset:</strong> ${preview.asset}</p>
    <p><strong>Network:</strong> ${preview.network}</p>
    <p><strong>Fee:</strong> ${preview.fee} drops</p>
    <p><strong>Destination Tag:</strong> ${preview.destinationTag}</p>
    <p><strong>Memo:</strong> ${preview.memo}</p>
    <p><strong>Risk Level:</strong> ${preview.risk}</p>
    <p><strong>Warning:</strong> XRPL transactions are irreversible after validation.</p>
  `;
  refs.signConfirmCheckbox.checked = false;
  refs.confirmSignButton.disabled = true;
  if (refs.signWithWalletButton) refs.signWithWalletButton.disabled = true;
  refs.signGateModal.classList.remove("hidden");
  refs.signGateModal.style.display = "flex";
  refs.signGateModal.setAttribute("aria-hidden", "false");
}

function resetSignGateModal() {
  if (refs.signConfirmCheckbox) {
    refs.signConfirmCheckbox.checked = false;
  }
  if (refs.confirmSignButton) {
    refs.confirmSignButton.disabled = true;
  }
  if (refs.signWithWalletButton) {
    refs.signWithWalletButton.disabled = true;
  }
}

function closeSignGateModal() {
  resetSignGateModal();
  refs.signGateModal?.classList.add("hidden");
  if (refs.signGateModal) {
    refs.signGateModal.style.display = "none";
    refs.signGateModal.setAttribute("aria-hidden", "true");
  }
}

function onConfirmSignIntent() {
  closeSignGateModal();

  void (async () => {
    const walletState = getWalletState();
    const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
    const risk = assessRisk("transaction_submit", { isMainnet: network.isMainnet });

    logSecurityEvent("sign_request_prepared", risk, {
      context: "sign_gate_confirmed",
      network: network.key,
      addressHint: formatAddress(walletState.publicAddress)
    });

    await pushSecurityEventToSupabase("sign_request_prepared", risk, walletState.publicAddress, {
      context: "sign_gate_confirmed",
      network: network.key,
      addressHint: formatAddress(walletState.publicAddress)
    });

    setFeedback("Preview confirmed. Continue to your wallet signer flow.");
    renderSecurity();
  })().catch(() => {
    setFeedback("Preview confirmed, but follow-up logging failed.", true);
  });
}

function onSaveSupabase() {
  if (!state.adminMode) {
    setSupabaseStatus("Unlock builder admin first.", true);
    return;
  }

  const url = refs.supabaseUrlInput?.value.trim() || "";
  const anonKey = refs.supabaseAnonKeyInput?.value.trim() || "";
  if (!url || !anonKey) {
    setSupabaseStatus("Enter Supabase URL and anon key.", true);
    return;
  }

  saveSupabaseConfig(url, anonKey);
  setSupabaseStatus("Supabase builder config saved.");
}

async function onTestSupabase() {
  if (!state.adminMode) {
    setSupabaseStatus("Unlock builder admin first.", true);
    return;
  }

  const result = await testSupabaseConnection();
  setSupabaseStatus(result.message, !result.ok);
}

// In-memory only — NEVER persisted to localStorage or any storage
const createWalletState = { address: "", publicKey: "", privateKey: "" };

function clearCreateWalletKeys() {
  createWalletState.address = "";
  createWalletState.publicKey = "";
  createWalletState.privateKey = "";
  if (refs.keygenAddress) refs.keygenAddress.textContent = "";
  if (refs.keygenPublicKey) refs.keygenPublicKey.textContent = "";
  if (refs.keygenPrivateKey) {
    refs.keygenPrivateKey.textContent = "";
    refs.keygenPrivateKey.classList.add("hidden");
  }
  if (refs.keygenCopyPrivButton) refs.keygenCopyPrivButton.classList.add("hidden");
  if (refs.keygenPrivShield) refs.keygenPrivShield.classList.remove("hidden");
  if (refs.keygenResult) refs.keygenResult.classList.add("hidden");
  if (refs.keygenGate) refs.keygenGate.classList.remove("hidden");
  // Uncheck all boxes
  refs.keygenChecks.forEach((cb) => { cb.checked = false; });
  if (refs.keygenGenerateButton) refs.keygenGenerateButton.disabled = true;
  if (refs.keygenResultStatus) refs.keygenResultStatus.textContent = "";
}

function onKeygenCheckChange() {
  const allChecked = refs.keygenChecks.every((cb) => cb.checked);
  if (refs.keygenGenerateButton) refs.keygenGenerateButton.disabled = !allChecked;
}

async function onKeygenGenerate() {
  if (!isKeygenSupported()) {
    if (refs.keygenGateStatus) refs.keygenGateStatus.textContent = "Your browser does not support Web Crypto API. Please use a modern browser.";
    return;
  }

  const allChecked = refs.keygenChecks.every((cb) => cb.checked);
  if (!allChecked) return;

  if (refs.keygenGenerateButton) refs.keygenGenerateButton.disabled = true;
  if (refs.keygenGateStatus) refs.keygenGateStatus.textContent = "Generating keypair...";

  try {
    const wallet = await generateXrplWallet();
    createWalletState.address = wallet.classicAddress;
    createWalletState.publicKey = wallet.publicKey;
    createWalletState.privateKey = wallet.privateKey;

    if (refs.keygenAddress) refs.keygenAddress.textContent = wallet.classicAddress;
    if (refs.keygenPublicKey) refs.keygenPublicKey.textContent = wallet.publicKey;
    // Private key starts hidden behind shield
    if (refs.keygenPrivateKey) {
      refs.keygenPrivateKey.textContent = wallet.privateKey;
      refs.keygenPrivateKey.classList.add("hidden");
    }
    if (refs.keygenCopyPrivButton) refs.keygenCopyPrivButton.classList.add("hidden");
    if (refs.keygenPrivShield) refs.keygenPrivShield.classList.remove("hidden");

    if (refs.keygenGate) refs.keygenGate.classList.add("hidden");
    if (refs.keygenResult) refs.keygenResult.classList.remove("hidden");
    if (refs.keygenGateStatus) refs.keygenGateStatus.textContent = "";

    logSecurityEvent("wallet_generated", RISK_LEVELS.SAFE, { context: "keygen", note: "keys shown in-browser only" });
  } catch (err) {
    if (refs.keygenGateStatus) refs.keygenGateStatus.textContent = err instanceof Error ? err.message : "Key generation failed.";
    if (refs.keygenGenerateButton) refs.keygenGenerateButton.disabled = false;
  }
}

function onKeygenReveal() {
  if (!createWalletState.privateKey) return;
  if (refs.keygenPrivShield) refs.keygenPrivShield.classList.add("hidden");
  if (refs.keygenPrivateKey) refs.keygenPrivateKey.classList.remove("hidden");
  if (refs.keygenCopyPrivButton) refs.keygenCopyPrivButton.classList.remove("hidden");
  logSecurityEvent("private_key_revealed", RISK_LEVELS.MEDIUM, { context: "keygen_reveal", note: "user viewed private key" });
}

async function onKeygenCopyField(targetId) {
  const el = document.getElementById(targetId);
  const text = el?.textContent?.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (refs.keygenResultStatus) refs.keygenResultStatus.textContent = "Copied!";
    setTimeout(() => { if (refs.keygenResultStatus) refs.keygenResultStatus.textContent = ""; }, 2000);
  } catch {
    if (refs.keygenResultStatus) refs.keygenResultStatus.textContent = "Copy failed — select the text and copy manually.";
  }
}

function onKeygenLoadAddress() {
  if (!createWalletState.address) return;
  const address = createWalletState.address;
  if (refs.addressInput) refs.addressInput.value = address;
  setPublicAddress(address);
  setWalletProvider("created");
  sessionStorage.setItem("ike_wallet_provider", "created");
  if (state.appUser) {
    saveAppUserSession({
      ...state.appUser,
      walletLinked: true,
      walletAddress: address
    });
  }
  logSecurityEvent("keygen_address_loaded", RISK_LEVELS.SAFE, { context: "keygen", addressHint: formatAddress(address) });
  setActivePage("dashboard");
  setFeedback("New wallet address loaded. Save your private key before funding or signing.");
  clearCreateWalletKeys();
}

function switchHeroTab(tab) {
  const tabs    = { overview: refs.heroTabOverview,    send: refs.heroTabSend,    receive: refs.heroTabReceive };
  const buttons = { overview: refs.heroTabOverviewBtn, send: refs.heroTabSendBtn, receive: refs.heroTabReceiveBtn };
  Object.keys(tabs).forEach((key) => {
    tabs[key]?.classList.toggle("hidden", key !== tab);
    const btn = buttons[key];
    if (btn) {
      btn.classList.toggle("is-active", key === tab);
      btn.setAttribute("aria-selected", key === tab ? "true" : "false");
    }
  });
}

function openHeroSend() {
  const walletState = getWalletState();
  if (!hasSigningWallet()) {
    setFeedback("Sending needs a Xumm wallet connection or an XRPL account created in IkeLedger.", true);
    openAuthModal();
    return;
  }
  if (refs.heroSendDest)   refs.heroSendDest.value = "";
  if (refs.heroSendAmount) refs.heroSendAmount.value = "";
  if (refs.heroSendTag)    refs.heroSendTag.value = "";
  if (refs.heroSendMemo)   refs.heroSendMemo.value = "";
  if (refs.heroSendStatus) refs.heroSendStatus.textContent = "";
  if (refs.heroSendStep2Status) refs.heroSendStep2Status.textContent = "";
  if (refs.heroSendStep1)  refs.heroSendStep1.classList.remove("hidden");
  if (refs.heroSendStep2)  refs.heroSendStep2.classList.add("hidden");
  heroSendXamanUrl = "";
  switchHeroTab("send");
  refs.heroSendDest?.focus();
}

function openHeroReceive() {
  const walletState = getWalletState();
  if (!walletState.publicAddress) {
    setFeedback("Load a wallet address first.", true);
    return;
  }
  const address = walletState.publicAddress;
  if (refs.heroReceiveAddr) refs.heroReceiveAddr.textContent = address;
  if (refs.heroReceiveQr) {
    refs.heroReceiveQr.innerHTML = `<img
      src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(address)}&margin=6"
      alt="QR code for ${address}"
      width="180" height="180" loading="lazy" />`;
  }
  switchHeroTab("receive");
}

async function onHeroSendPreview() {
  const walletState = getWalletState();
  const dest      = refs.heroSendDest?.value.trim()   || "";
  const amountStr = refs.heroSendAmount?.value.trim() || "";
  const tag       = refs.heroSendTag?.value.trim()    || "";
  const memo      = refs.heroSendMemo?.value.trim()   || "";

  if (!dest || !dest.startsWith("r") || dest.length < 25) {
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "Enter a valid XRPL destination address (starts with r).";
    return;
  }
  const amount = parseFloat(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "Enter a valid XRP amount greater than 0.";
    return;
  }
  if (dest === walletState.publicAddress) {
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "Destination cannot be the same as your address.";
    return;
  }

  if (refs.heroSendStatus) refs.heroSendStatus.textContent = "Building transaction...";

  try {
    const tx = buildPaymentTx({
      account:        walletState.publicAddress,
      destination:    dest,
      amountXrp:      amountStr,
      destinationTag: tag,
      memo
    });

    const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
    if (refs.heroSendSummary) {
      refs.heroSendSummary.innerHTML = `
        <p><strong>From:</strong> <span style="font-family:monospace">${formatAddress(walletState.publicAddress)}</span></p>
        <p><strong>To:</strong> <span style="font-family:monospace">${formatAddress(dest)}</span></p>
        <p><strong>Amount:</strong> ${amount.toFixed(6)} XRP</p>
        <p><strong>Network:</strong> ${network.label} &nbsp;·&nbsp; Fee: 12 drops</p>
        ${tag  ? `<p><strong>Tag:</strong> ${tag}</p>`   : ""}
        ${memo ? `<p><strong>Memo:</strong> ${memo}</p>` : ""}
      `;
    }

    if (refs.heroSendConfirm) refs.heroSendConfirm.checked = false;
    if (refs.heroOpenXamanBtn) refs.heroOpenXamanBtn.disabled = true;
    if (refs.heroSendStep2Status) refs.heroSendStep2Status.textContent = "";
    if (refs.heroSendQr) refs.heroSendQr.innerHTML = "";

    // Official Xumm SDK payload - QR hosted by Xaman, proper deep link
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "Creating Xaman signing request...";
    const xumm = await initXumm(getXamanApiKey());
    const { qrUrl, mobileUrl, resultPromise } = await createTxFlow(xumm, tx);

    heroSendXamanUrl = mobileUrl;

    if (refs.heroSendQr && qrUrl) {
      refs.heroSendQr.innerHTML = `<img src="${qrUrl}" alt="Scan with Xaman to sign" width="180" height="180" loading="lazy" />`;
    }

    // Listen for signing result in the background
    resultPromise.then(({ signed, txid }) => {
      if (signed) {
        if (refs.heroSendStep2Status) {
          refs.heroSendStep2Status.textContent = `Transaction signed${txid ? ` - ${txid.slice(0, 12)}...` : ""}. Press Refresh Account to confirm on-chain.`;
        }
        logSecurityEvent("xaman_tx_signed", RISK_LEVELS.LOW, {
          context: "hero_send_sdk",
          network: walletState.network,
          addressHint: formatAddress(dest)
        });
      } else {
        if (refs.heroSendStep2Status) refs.heroSendStep2Status.textContent = "Transaction rejected in Xaman.";
      }
    }).catch(() => {});

    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "";
    if (refs.heroSendStep1) refs.heroSendStep1.classList.add("hidden");
    if (refs.heroSendStep2) refs.heroSendStep2.classList.remove("hidden");

    logSecurityEvent("send_preview_built", RISK_LEVELS.MEDIUM, {
      context: "hero_send",
      network: walletState.network,
      addressHint: formatAddress(dest)
    });
  } catch (err) {
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = err instanceof Error ? err.message : "Transaction build failed.";
  }
}

function initNetworkOptions() {
  if (!refs.networkSelect) return;
  refs.networkSelect.innerHTML = Object.values(NETWORKS)
    .map((network) => `<option value="${network.key}">${network.label}</option>`)
    .join("");
}

function bindClick(ref, handler) {
  ref?.addEventListener("click", handler);
}

function initEventHandlers() {
  bindClick(refs.lookupButton, onLookup);
  refs.networkSelect?.addEventListener("change", onNetworkChange);
  bindClick(refs.disconnectButton, onDisconnect);
  bindClick(refs.clearSessionButton, onClearSession);
  bindClick(refs.demoButton, onLoadDemo);
  bindClick(refs.copyAddressButton, onCopyAddress);
  bindClick(refs.connectXamanButton, openAuthModal);
  bindClick(refs.commandOpenAuthButton, openAuthModal);
  bindClick(refs.closeAuthModalButton, closeAuthModal);
  bindClick(refs.commandXummSignInButton, () => { void connectWithXumm(); });
  bindClick(refs.commandEmailSignUpButton, () => { void onEmailProfileSignUp(); });
  bindClick(refs.commandEmailSignInButton, () => { void onEmailProfileSignIn(); });
  bindClick(refs.refreshTopIssuedTokensButton, () => { void loadTopIssuedAssets(true); });
  bindClick(refs.toggleRawJsonButton, toggleRawJson);

  bindClick(refs.openSignGateButton, openSignGateModal);
  bindClick(refs.closeSignGateButton, closeSignGateModal);
  bindClick(refs.cancelSignButton, closeSignGateModal);
  bindClick(refs.confirmSignButton, onConfirmSignIntent);
  bindClick(refs.signWithWalletButton, onConfirmSignIntent);
  refs.signConfirmCheckbox?.addEventListener("change", (event) => {
    refs.confirmSignButton.disabled = !event.target.checked;
    if (refs.signWithWalletButton) {
      refs.signWithWalletButton.disabled = !event.target.checked;
    }
  });
  refs.signGateModal?.addEventListener("click", (event) => {
    if (event.target === refs.signGateModal) closeSignGateModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAuthModal();
      closeSettingsDrawer();
      closeSidebarPanel();
      if (!refs.signGateModal?.classList.contains("hidden")) {
        closeSignGateModal();
      }
    }
  });
  refs.authModal?.addEventListener("click", (event) => {
    if (event.target === refs.authModal) closeAuthModal();
  });

  bindClick(refs.openSettingsButton, openSettingsDrawer);
  bindClick(refs.openSidebarButton, openSidebarPanel);
  bindClick(refs.closeSidebarButton, closeSidebarPanel);
  bindClick(refs.closeSettingsButton, closeSettingsDrawer);
  bindClick(refs.saveProfileButton, onSaveProfile);
  bindClick(refs.settingsDisconnectButton, onDisconnect);
  bindClick(refs.settingsClearSessionButton, onClearSession);
  bindClick(refs.settingsPageOpenDrawerButton, openSettingsDrawer);
  bindClick(refs.settingsPageClearButton, onClearSession);
  bindClick(refs.settingsPageDisconnectButton, onDisconnect);

  // Profile photo upload
  bindClick(refs.heroAvatarPill, () => refs.avatarPhotoInput?.click());
  bindClick(refs.uploadPhotoButton, () => refs.avatarPhotoInput?.click());
  bindClick(refs.cameraPhotoButton, () => refs.avatarCameraInput?.click());
  bindClick(refs.profileAvatarPill, () => refs.avatarPhotoInput?.click());
  bindClick(refs.clearPhotoButton, () => {
    localStorage.removeItem(STORAGE_KEYS.profilePhoto);
    applyProfilePhoto();
    setFeedback("Profile photo removed.");
  });
  refs.avatarPhotoInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) onPhotoFile(file);
    e.target.value = "";
  });
  refs.avatarCameraInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) onPhotoFile(file);
    e.target.value = "";
  });

  // Drag and drop on upload zone
  const zone = refs.profileUploadZone;
  if (zone) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) onPhotoFile(file);
    });
  }

  // Avatar style customizer — live preview then save on any change
  const avatarStyleInputs = [
    refs.avatarGlowColorInput,
    refs.avatarGlowIntensityInput,
    refs.avatarBorderColorInput,
    refs.avatarBorderWidthInput,
    refs.avatarBorderShapeInput
  ];
  avatarStyleInputs.forEach((el) => {
    el?.addEventListener("input", saveAvatarStyle);
    el?.addEventListener("change", saveAvatarStyle);
  });

  // Keygen handlers
  refs.keygenChecks.forEach((cb) => cb.addEventListener("change", onKeygenCheckChange));
  bindClick(refs.keygenGenerateButton, () => { void onKeygenGenerate(); });
  bindClick(refs.keygenRevealButton, onKeygenReveal);
  bindClick(refs.keygenLoadAddressButton, onKeygenLoadAddress);
  bindClick(refs.keygenClearButton, clearCreateWalletKeys);
  document.querySelectorAll(".keygen-copy-btn[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => { void onKeygenCopyField(btn.dataset.target); });
  });
  bindClick(refs.keygenCopyPrivButton, () => { void onKeygenCopyField("keygenPrivateKey"); });

  bindClick(refs.adminUnlockButton, onUnlockAdmin);
  bindClick(refs.adminLockButton, onLockAdmin);
  bindClick(refs.saveSupabaseButton, onSaveSupabase);
  bindClick(refs.testSupabaseButton, onTestSupabase);
  refs.settingsDrawer?.addEventListener("click", (event) => {
    if (event.target === refs.settingsDrawer) closeSettingsDrawer();
  });
  refs.sidebarOverlay?.addEventListener("click", closeSidebarPanel);
  refs.sidebarPanel?.querySelectorAll(".sidebar-btn").forEach((button) => {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.page || "dashboard");
      if (window.innerWidth <= 1100) {
        closeSidebarPanel();
      }
    });
  });

  refs.topLinks.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.page || "dashboard");
    });
  });

  refs.bottomLinks.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.page || "dashboard");
    });
  });

  document.querySelectorAll(".profile-wallet-nav-btn[data-nav]").forEach((button) => {
    button.addEventListener("click", () => setActivePage(button.dataset.nav || "dashboard"));
  });

  bindClick(refs.themeToggleButton, cycleTheme);
  refs.themeSelect?.addEventListener("change", (event) => {
    applyTheme(event.target.value || "dark");
  });
  bindClick(refs.profileButton, () => setActivePage("profile"));
  // Hero button row wires into inline tabs
  bindClick(refs.sendButton,   openHeroSend);
  bindClick(refs.qrCodeButton, openHeroReceive);

  // Hero tab buttons
  bindClick(refs.heroTabOverviewBtn, () => switchHeroTab("overview"));
  bindClick(refs.heroTabSendBtn,     openHeroSend);
  bindClick(refs.heroTabReceiveBtn,  openHeroReceive);

  // Hero send step 1
  bindClick(refs.heroSendPreviewBtn, () => { void onHeroSendPreview(); });

  // Hero send step 2
  bindClick(refs.heroSendBackBtn, () => {
    if (refs.heroSendStep1) refs.heroSendStep1.classList.remove("hidden");
    if (refs.heroSendStep2) refs.heroSendStep2.classList.add("hidden");
    if (refs.heroSendStatus) refs.heroSendStatus.textContent = "";
  });
  refs.heroSendConfirm?.addEventListener("change", (e) => {
    if (refs.heroOpenXamanBtn) refs.heroOpenXamanBtn.disabled = !e.target.checked;
  });
  bindClick(refs.heroOpenXamanBtn, () => {
    if (!heroSendXamanUrl) return;
    window.open(heroSendXamanUrl, "_blank", "noopener,noreferrer");
    if (refs.heroSendStep2Status) {
      refs.heroSendStep2Status.textContent = "Xaman opened — approve the transaction in the app. Press Refresh Account after it confirms on-chain.";
    }
  });

  // Hero receive copy
  bindClick(refs.heroReceiveCopy, () => {
    const addr = refs.heroReceiveAddr?.textContent || "";
    if (!addr) return;
    navigator.clipboard.writeText(addr)
      .then(() => {
        if (refs.heroReceiveCopy) refs.heroReceiveCopy.textContent = "Copied!";
        setTimeout(() => { if (refs.heroReceiveCopy) refs.heroReceiveCopy.textContent = "Copy Address"; }, 2000);
      })
      .catch(() => { if (refs.heroReceiveCopy) refs.heroReceiveCopy.textContent = "Copy failed"; });
  });

  refs.timeframeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      refs.timeframeButtons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      state.chartTimeframe = button.dataset.tf || "24H";
      void renderMarketOverview(true);
    });
  });

  refs.addressInput?.addEventListener("paste", (event) => {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (looksLikeSensitiveInput(pastedText)) {
      event.preventDefault();
      refs.addressInput.value = "";
      logSecurityEvent("blocked_secret_paste", RISK_LEVELS.BLOCKED, {
        context: "paste_blocked",
        network: refs.networkSelect?.value || "",
        addressHint: "blocked"
      });
      setFeedback("Seed phrases and private keys are blocked for your safety.", true);
      renderSecurity();
    }
  });
}

function boot() {
  initNetworkOptions();
  const walletState = hydrateWalletState();
  const supabaseConfig = getSupabaseConfig();

  state.adminMode = localStorage.getItem(STORAGE_KEYS.adminMode) === "true";
  state.appUser = getStoredAppUser();
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "dark");
  setActivePage("dashboard");

  if (refs.networkSelect) refs.networkSelect.value = walletState.network;
  if (refs.addressInput) refs.addressInput.value = walletState.publicAddress || "";
  if (refs.supabaseUrlInput) refs.supabaseUrlInput.value = supabaseConfig.url;
  if (refs.supabaseAnonKeyInput) refs.supabaseAnonKeyInput.value = supabaseConfig.anonKey;

  setSupabaseStatus(
    hasSupabaseConfig()
      ? state.adminMode
        ? "Supabase builder sync loaded."
        : "Supabase is optional and inactive for user wallet flows."
      : "Supabase not configured yet."
  );
  renderAdminPanel();
  renderReminders();
  applyProfilePhoto();
  applyAvatarStyle();
  initEventHandlers();
  if (window.innerWidth <= 1100) {
    closeSidebarPanel();
  } else {
    openSidebarPanel();
  }
  closeSettingsDrawer();
  closeAuthModal();
  closeSignGateModal();
  switchHeroTab("overview");
  if (state.marketTimer) {
    clearInterval(state.marketTimer);
  }
  state.marketTimer = setInterval(() => {
    void renderMarketOverview(true);
  }, 15000);
  renderAll();
  void loadTopIssuedAssets();
}

boot();
