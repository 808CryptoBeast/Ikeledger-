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
import { buildPaymentTx, xrpToDrops } from "./ikeledger-xaman.js";
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
const MARKET_RESULT_LIMIT = 100;
const MARKET_VISIBLE_STEP = 50;
const TOP_ISSUED_ASSETS_URL = `https://api.xrpl.to/v1/tokens?sortBy=marketcap&sortType=desc&limit=${MARKET_RESULT_LIMIT}`;
const TOP_AMM_POOLS_URL = `https://api.xrpl.to/v1/tokens?sortBy=tvl&sortType=desc&limit=${MARKET_RESULT_LIMIT}`;
const TOP_ISSUED_ASSETS_CACHE_KEY = "ike_top_issued_assets_v3";
const TOP_AMM_POOLS_CACHE_KEY = "ike_top_amm_pools_v3";
const TOP_ISSUED_ASSETS_CACHE_MS = 6 * 60 * 60 * 1000;
const TOP_AMM_POOLS_CACHE_MS = 6 * 60 * 60 * 1000;
const TOP_AMM_POOLS_BACKOFF_MS = 5 * 60 * 1000;
const DEX_BOOK_LIMIT = 20;
const OFFER_CREATE_FLAGS = {
  passive: 0x00010000,
  ioc: 0x00020000,
  fok: 0x00040000
};

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
  topAmmFilter: "",
  topIssuedVisibleCount: MARKET_VISIBLE_STEP,
  topAmmVisibleCount: MARKET_VISIBLE_STEP,
  tokenWatchlist: new Set(),
  ammWatchlist: new Set(),
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
  },
  topAmmPools: {
    fetchedAt: 0,
    items: [],
    loading: false,
    error: "",
    backoffUntil: 0
  },
  dex: {
    selectedTokenId: "",
    side: "buy",
    currency: "",
    issuer: "",
    amount: "",
    price: "",
    orderStyle: "limit",
    slippage: "1",
    stopLoss: "",
    takeProfit: "",
    latestTx: null,
    signing: false,
    orderBook: {
      loading: false,
      error: "",
      bids: [],
      asks: [],
      updatedAt: 0
    },
    chart: {
      candles: [],
      loading: false,
      error: "",
      label: "",
      tokenId: "",
      cacheKey: "",
      fetchedAt: 0,
      timeframe: "1D",
      chartType: "candle",
      indicators: { ma20: true, ma50: true, ema20: false, bb: false, volume: true, rsi: false }
    }
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
  marketLastUpdated: document.getElementById("marketLastUpdated"),
  marketSourceCoinGecko: document.getElementById("marketSourceCoinGecko"),
  marketSourceXrpl: document.getElementById("marketSourceXrpl"),
  marketSourceXrplTo: document.getElementById("marketSourceXrplTo"),
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
  commandXummModeHint: document.getElementById("commandXummModeHint"),
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
  topAmmPoolsPanel: document.getElementById("topAmmPoolsPanel"),
  refreshTopAmmPoolsButton: document.getElementById("refreshTopAmmPoolsButton"),
  nftsPagePanel: document.getElementById("nftsPagePanel"),
  nftListingsPagePanel: document.getElementById("nftListingsPagePanel"),
  dexPagePanel: document.getElementById("dexPagePanel"),
  dexAccessBadge: document.getElementById("dexAccessBadge"),
  dexAssetSelect: document.getElementById("dexAssetSelect"),
  dexSideSelect: document.getElementById("dexSideSelect"),
  dexCurrencyInput: document.getElementById("dexCurrencyInput"),
  dexIssuerInput: document.getElementById("dexIssuerInput"),
  dexAmountInput: document.getElementById("dexAmountInput"),
  dexPriceInput: document.getElementById("dexPriceInput"),
  dexOrderStyleSelect: document.getElementById("dexOrderStyleSelect"),
  dexSlippageInput: document.getElementById("dexSlippageInput"),
  dexStopLossInput: document.getElementById("dexStopLossInput"),
  dexTakeProfitInput: document.getElementById("dexTakeProfitInput"),
  dexAnalyzeButton: document.getElementById("dexAnalyzeButton"),
  dexSignOfferButton: document.getElementById("dexSignOfferButton"),
  dexRefreshBookButton: document.getElementById("dexRefreshBookButton"),
  dexTicketStatus: document.getElementById("dexTicketStatus"),
  dexBookUpdated: document.getElementById("dexBookUpdated"),
  dexStatsPanel: document.getElementById("dexStatsPanel"),
  dexOrderBookPanel: document.getElementById("dexOrderBookPanel"),
  dexAnalysisChart: document.getElementById("dexAnalysisChart"),
  dexRiskRewardPanel: document.getElementById("dexRiskRewardPanel"),
  dexExecutionPlanPanel: document.getElementById("dexExecutionPlanPanel"),
  dexSafetyPanel: document.getElementById("dexSafetyPanel"),
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
  marketProxyUrlInput: document.getElementById("marketProxyUrlInput"),
  saveMarketProxyButton: document.getElementById("saveMarketProxyButton"),
  clearMarketProxyButton: document.getElementById("clearMarketProxyButton"),
  marketProxyStatus: document.getElementById("marketProxyStatus"),
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

function formatUnsignedPercent(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}%`;
}

function formatAmmFee(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "n/a";
  const percent = Number.isInteger(n) ? n / 1000 : n;
  return `${percent.toFixed(Math.abs(percent) < 1 ? 3 : 2)}%`;
}

function imageProxyUrl(url = "") {
  const clean = String(url || "").trim();
  if (!clean) return "";
  if (clean.startsWith("./") || clean.startsWith("/")) return clean;
  if (!/^https?:\/\//i.test(clean)) return "";
  const proxyBase = (localStorage.getItem(STORAGE_KEYS.marketProxyBaseUrl) || "").trim().replace(/\/$/, "");
  if (proxyBase) {
    return `${proxyBase}/image?url=${encodeURIComponent(clean)}&w=96&h=96`;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=96&h=96&fit=cover&output=webp`;
}

function normalizeLogoSource(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.startsWith("ipfs://") || clean.startsWith("ar://") || /^https?:\/\//i.test(clean)) {
    return toIpfsGateway(clean);
  }
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]+)$/i.test(clean)) {
    return `https://ipfs.io/ipfs/${clean}`;
  }
  return "";
}

function tokenLogoUrl(token = {}) {
  const localLogo = String(token.localLogo || token.localLogoUrl || "").trim();
  if (localLogo.startsWith("./") || localLogo.startsWith("/")) return localLogo;

  const directLogo = normalizeLogoSource(
    token.tomlIcon
    || token.icon
    || token.logo
    || token.logoUrl
    || token.image
    || token.imageUrl
    || ""
  );
  if (directLogo) return imageProxyUrl(directLogo);

  const md5 = String(token.md5 || token._id || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(md5)) return "";
  const version = token.imgUpdated || token.time || token.lastModified || token.dateon || "";
  const versionQuery = version ? `&t=${encodeURIComponent(String(version))}` : "";
  return imageProxyUrl(`https://www.xrpl.to/api/proxy/api/thumb/${encodeURIComponent(md5)}?w=96${versionQuery}`);
}

function tokenLogoMarkup(token = {}, label = "") {
  const initials = String(label || "?").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "?";
  const logoUrl = String(token.logoUrl || "").trim();
  const proxyBase = (localStorage.getItem(STORAGE_KEYS.marketProxyBaseUrl) || "").trim().replace(/\/$/, "");
  const safeLogoUrl = logoUrl.startsWith("./")
    || logoUrl.startsWith("/")
    || logoUrl.startsWith("https://wsrv.nl/")
    || (proxyBase && logoUrl.startsWith(`${proxyBase}/image?`))
    ? logoUrl : "";
  if (!safeLogoUrl) {
    return `<span class="token-logo is-fallback"><span>${escapeHtml(initials)}</span></span>`;
  }
  return `
    <span class="token-logo">
      <span>${escapeHtml(initials)}</span>
      <img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(label)} logo" loading="lazy" onerror="this.parentElement.classList.add('is-fallback'); this.remove();" />
    </span>
  `;
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

function isLikelyMobileDevice() {
  return window.matchMedia?.("(max-width: 760px), (pointer: coarse)")?.matches
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function xummSignInButtonLabel() {
  return isLikelyMobileDevice() ? "Open Xumm / Xaman" : "Sign In with Xumm";
}

function xummSignInGuidance() {
  return isLikelyMobileDevice()
    ? "Same-phone sign in opens Xumm/Xaman, then returns here after approval. Keep this browser tab open."
    : "Desktop sign in shows the official Xumm QR flow. Scan it with Xumm/Xaman on your phone.";
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

  if (page === "tokens") {
    void loadTopIssuedAssets();
  }

  if (page === "dex") {
    void loadTopIssuedAssets();
    void loadDexOrderBook();
    void loadDexChart();
  }

  if (page === "amm") {
    void loadTopAmmPools();
  }
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

const _mjCache          = new Map(); // url → { data, ts }
const _mjInFlight       = new Map(); // url → Promise
const _domainTail       = new Map(); // hostname → tail of sequential queue
const _rateLimitedUntil = new Map(); // hostname → timestamp: don't request before this
const MJ_TTL = 120_000;              // 2-minute cache

// Serialize all requests to the same host so we never fire concurrent fetches
function _queuedFetch(url, fn) {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* noop */ }
  const prev = _domainTail.get(host) ?? Promise.resolve();
  const task = prev.then(fn);
  _domainTail.set(host, task.then(() => {}, () => {})); // tail never rejects
  return task;
}

async function fetchMarketJson(url) {
  const hit = _mjCache.get(url);
  if (hit && Date.now() - hit.ts < MJ_TTL) return hit.data;
  if (_mjInFlight.has(url)) return _mjInFlight.get(url);

  const proxyBase = (localStorage.getItem(STORAGE_KEYS.marketProxyBaseUrl) || "").trim().replace(/\/$/, "");
  const requestUrl = proxyBase ? `${proxyBase}/market?url=${encodeURIComponent(url)}` : url;

  let reqHost = "";
  try { reqHost = new URL(requestUrl).hostname; } catch { /* noop */ }

  const doFetch = async () => {
    // Adaptive rate-limit backoff — if recently 429'd, wait it out
    const rlUntil = _rateLimitedUntil.get(reqHost) || 0;
    if (Date.now() < rlUntil) await new Promise((r) => setTimeout(r, rlUntil - Date.now()));

    const response = await fetch(requestUrl, { headers: { accept: "application/json" } });
    if (response.status === 429) {
      _rateLimitedUntil.set(reqHost, Date.now() + 4000); // 4-second cooldown for this host
      const error = new Error("Market API rate limited (429)");
      error.status = 429;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Market API failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    _mjCache.set(url, { data, ts: Date.now() });
    return data;
  };

  const promise = _queuedFetch(url, doFetch).finally(() => { _mjInFlight.delete(url); });
  _mjInFlight.set(url, promise);
  return promise;
}

// USD stablecoins on XRPL DEX (tried in order for XRP spot price)
const XRP_USD_PAIRS = [
  // RLUSD — Ripple's official USD stablecoin on XRPL mainnet
  { currency: "524C555344000000000000000000000000000000", issuer: "rMxCKbEDwqr96QEkjFd7AgfnH6PBicCzgE" },
  // USD — Gatehub, long-established XRPL issuer
  { currency: "USD", issuer: "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq" },
];

async function fetchXrpSpotPrice() {
  const walletState = getWalletState();
  const network = walletState.network || DEFAULT_NETWORK;
  for (const usd of XRP_USD_PAIRS) {
    try {
      // book_offers taker_gets=XRP, taker_pays=USD → asks (selling XRP for USD)
      const result = await requestXrplCommand(network, {
        command: "book_offers",
        taker_gets: { currency: "XRP" },
        taker_pays: usd,
        limit: 5
      });
      const offers = result?.offers || [];
      if (!offers.length) continue;
      const o = offers[0];
      const drops = Number(o.TakerGets || 0);
      const usdVal = Number(o.TakerPays?.value || 0);
      if (drops > 0 && usdVal > 0) return usdVal / (drops / 1e6);
    } catch { /* try next pair */ }
  }
  return 0;
}

// ── Kraken — XRP/USD only (CORS-friendly, globally accessible) ───────
// All issued XRPL tokens use xrpl.to. Kraken is used only for XRP itself.
async function fetchKrakenXrpOhlcv(krakenInterval, limit) {
  const since = Math.floor(Date.now() / 1000) - krakenInterval * 60 * (limit + 2);
  const url = `https://api.kraken.com/0/public/OHLC?pair=XRPUSD&interval=${krakenInterval}&since=${since}`;
  const json = await fetchMarketJson(url);
  if (json.error?.length) throw new Error(`Kraken: ${json.error[0]}`);
  const key = Object.keys(json.result || {}).find((k) => k !== "last");
  const rows = json.result?.XXRPZUSD ?? json.result?.XRPUSD ?? json.result?.[key] ?? [];
  return (Array.isArray(rows) ? rows : [])
    .map((k) => ({ t: Number(k[0]) * 1000, o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[6]) }))
    .filter((c) => c.c > 0)
    .slice(-limit);
}

async function fetchXrpOverview() {
  try {
    const json = await fetchMarketJson("https://api.kraken.com/0/public/Ticker?pair=XRPUSD");
    if (!json.error?.length) {
      const key = Object.keys(json.result || {}).find((k) => k !== "last");
      const t = json.result?.XXRPZUSD ?? json.result?.XRPUSD ?? json.result?.[key];
      if (t) {
        const price = Number(t.c?.[0] || 0);
        const open  = Number(t.o || 0);
        const changePercent = open > 0 ? (price - open) / open * 100 : 0;
        const volume = Number(t.v?.[1] || 0) * price;
        return { price, changePercent, volume, marketCap: price * 57_670_000_000 };
      }
    }
  } catch { /* fall through to XRPL book_offers */ }
  const price = await fetchXrpSpotPrice();
  return { price, changePercent: 0, volume: 0, marketCap: price * 57_670_000_000 };
}

async function fetchXrpChartPoints(timeframe) {
  const [ki, limit] =
    timeframe === "1H"  ? [5,    12 ] :
    timeframe === "24H" ? [15,   96 ] :
    timeframe === "7D"  ? [60,   168] :
    timeframe === "30D" ? [240,  90 ] :
                          [1440, 120];
  const candles = await fetchKrakenXrpOhlcv(ki, limit);
  const points = candles.map((c) => c.c);
  if (!points.length) throw new Error("XRP chart data unavailable.");
  return points;
}

// ── XRPL WebSocket connection pool (one persistent socket per network) ──
const _xrplWs      = new Map(); // networkKey → WebSocket
const _xrplPending = new Map(); // networkKey → Map<id, {resolve, reject, timer}>
let   _xrplNextId  = 1;

function _xrplEnsureConnection(networkKey) {
  const existing = _xrplWs.get(networkKey);
  if (existing && existing.readyState <= WebSocket.OPEN) return; // CONNECTING(0) or OPEN(1)

  const network = NETWORKS[networkKey] || NETWORKS[DEFAULT_NETWORK];
  const ws      = new WebSocket(network.endpoint);
  const pending  = new Map();

  _xrplWs.set(networkKey, ws);
  _xrplPending.set(networkKey, pending);

  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      const entry   = pending.get(payload?.id);
      if (!entry) return;
      pending.delete(payload.id);
      clearTimeout(entry.timer);
      if (payload.status === "error" || payload.error) {
        entry.reject(new Error(payload.error_message || payload.error || "XRPL request failed."));
      } else {
        entry.resolve(payload.result || {});
      }
    } catch { /* ignore */ }
  });

  const cleanup = (msg) => {
    if (_xrplPending.get(networkKey) !== pending) return; // already replaced
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(msg)); }
    pending.clear();
    _xrplPending.delete(networkKey);
    _xrplWs.delete(networkKey);
  };

  ws.addEventListener("error", () => cleanup("XRPL WebSocket error."));
  ws.addEventListener("close", () => cleanup("XRPL WebSocket closed."));
}

async function requestXrplCommand(networkKey, command) {
  _xrplEnsureConnection(networkKey);
  const ws      = _xrplWs.get(networkKey);
  const pending  = _xrplPending.get(networkKey);
  if (!ws || !pending) return Promise.reject(new Error("No XRPL connection available."));

  return new Promise((resolve, reject) => {
    const id    = _xrplNextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("XRPL metric request timeout.")); }, 8000);

    pending.set(id, { resolve, reject, timer });

    const send = () => ws.send(JSON.stringify({ id, ...command }));
    if (ws.readyState === WebSocket.OPEN) {
      send();
    } else {
      ws.addEventListener("open", send, { once: true });
    }
  });
}

function ledgerTransactionCount(ledgerResult = {}) {
  const transactions = ledgerResult?.ledger?.transactions;
  if (Array.isArray(transactions)) return transactions.length;
  const count = Number(ledgerResult?.ledger?.txn_count ?? ledgerResult?.ledger?.transaction_count);
  return Number.isFinite(count) ? count : 0;
}

function ledgerCloseTime(ledgerResult = {}) {
  const closeTime = Number(ledgerResult?.ledger?.close_time || 0);
  return Number.isFinite(closeTime) ? closeTime : 0;
}

function formatLiveTps(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(value >= 10 ? 1 : 2)} tx/s`;
}

async function fetchXrplNetworkMetrics() {
  const walletState = getWalletState();
  const networkKey = walletState.network || DEFAULT_NETWORK;
  const [serverInfoResult, feeResult] = await Promise.all([
    requestXrplCommand(networkKey, { command: "server_info" }),
    requestXrplCommand(networkKey, { command: "fee" })
  ]);

  const ledgerIndex = Number(serverInfoResult?.info?.validated_ledger?.seq || 0);
  let tps = "n/a";
  if (ledgerIndex > 1) {
    try {
      const [latestLedger, previousLedger] = await Promise.all([
        requestXrplCommand(networkKey, {
          command: "ledger",
          ledger_index: ledgerIndex,
          transactions: true,
          expand: false
        }),
        requestXrplCommand(networkKey, {
          command: "ledger",
          ledger_index: ledgerIndex - 1,
          transactions: false,
          expand: false
        })
      ]);
      const txCount = ledgerTransactionCount(latestLedger);
      const latestClose = ledgerCloseTime(latestLedger);
      const previousClose = ledgerCloseTime(previousLedger);
      const seconds = latestClose > previousClose ? latestClose - previousClose : 3.8;
      tps = formatLiveTps(txCount / seconds);
    } catch {
      tps = "n/a";
    }
  }

  return {
    ledgerIndex,
    tps,
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

function setSourceChip(el, label, status = "Loading") {
  if (!el) return;
  const normalized = String(status || "Loading");
  el.textContent = `${label}: ${normalized}`;
  el.classList.toggle("is-live", normalized === "Live");
  el.classList.toggle("is-cached", normalized === "Cached" || normalized === "On demand");
  el.classList.toggle("is-warning", normalized === "Degraded" || normalized === "Loading");
}

function renderMarketSourceStatus(snapshot, fallbackStatus = "Loading") {
  const updatedAt = snapshot?.fetchedAt || state.marketCache.fetchedAt || 0;
  if (refs.marketLastUpdated) {
    refs.marketLastUpdated.textContent = updatedAt
      ? `Updated: ${new Date(updatedAt).toLocaleTimeString()}`
      : "Updated: -";
  }

  const sources = snapshot?.sources || {};
  setSourceChip(refs.marketSourceCoinGecko, "CoinGecko", sources.coingecko || fallbackStatus);
  setSourceChip(refs.marketSourceXrpl, "XRPL WS", sources.xrpl || fallbackStatus);
  setSourceChip(refs.marketSourceXrplTo, "XRPL.to", sources.xrplTo || "On demand");
}

function syncXrplToSourceStatus(status = "Cached") {
  if (!state.marketCache.snapshot) {
    setSourceChip(refs.marketSourceXrplTo, "XRPL.to", status);
    return;
  }
  state.marketCache.snapshot = {
    ...state.marketCache.snapshot,
    sources: {
      ...state.marketCache.snapshot.sources,
      xrplTo: status
    }
  };
  renderMarketSourceStatus(state.marketCache.snapshot);
}

function renderMarketSnapshot(snapshot) {
  if (!snapshot) return;
  if (Array.isArray(snapshot.points) && snapshot.points.length) {
    drawMarketChart(snapshot.points);
  }

  const price = toFiniteNumber(snapshot.price, Number.NaN);
  const volume = toFiniteNumber(snapshot.volume, Number.NaN);
  const marketCap = toFiniteNumber(snapshot.marketCap, Number.NaN);
  const changePercent = toFiniteNumber(snapshot.changePercent, Number.NaN);
  const feeDrops = snapshot.feeDrops || "n/a";
  const changePrefix = changePercent >= 0 ? "+" : "";
  const changeText = Number.isFinite(changePercent) ? `${changePrefix}${changePercent.toFixed(2)}%` : "n/a";

  if (refs.marketPrice) refs.marketPrice.textContent = Number.isFinite(price) ? `$${price.toFixed(4)}` : "n/a";
  if (refs.marketVolume) refs.marketVolume.textContent = Number.isFinite(volume) ? `$${Math.round(volume).toLocaleString()}` : "n/a";
  if (refs.marketCap) refs.marketCap.textContent = Number.isFinite(marketCap) ? `$${Math.round(marketCap).toLocaleString()}` : "n/a";
  if (refs.marketLedgerIndex) refs.marketLedgerIndex.textContent = snapshot.ledgerIndex ? snapshot.ledgerIndex.toLocaleString() : "n/a";
  if (refs.marketTps) refs.marketTps.textContent = snapshot.tps || "n/a";
  if (refs.marketFee) refs.marketFee.textContent = feeDrops === "n/a" ? "n/a" : `${feeDrops} drops`;
  if (refs.xrpPriceStat) refs.xrpPriceStat.textContent = Number.isFinite(price) ? `$${price.toFixed(4)}` : "n/a";
  if (refs.xrpChangeStat) refs.xrpChangeStat.textContent = changeText;
  if (refs.xrpNavPrice) {
    refs.xrpNavPrice.textContent = Number.isFinite(price) ? `$${price.toFixed(4)} ${changeText}` : "n/a";
    refs.xrpNavPrice.style.color = !Number.isFinite(changePercent)
      ? "var(--ink-2)"
      : changePercent >= 0 ? "var(--emerald)" : "var(--danger)";
  }
  renderMarketSourceStatus(snapshot);
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
        fetchXrplNetworkMetrics()
          .then((metrics) => ({ ...metrics, sourceOk: true }))
          .catch(() => ({ ledgerIndex: 0, tps: "n/a", feeDrops: "n/a", sourceOk: false }))
      ]);
      const fetchedAt = Date.now();

      snapshot = {
        ...overview,
        ...networkMetrics,
        points,
        fetchedAt,
        sources: {
          coingecko: "XRPL DEX",
          xrpl: networkMetrics.sourceOk ? "Live" : "Degraded",
          xrplTo: state.topIssuedAssets.items.length || state.topAmmPools.items.length ? "Cached" : "On demand"
        }
      };
      state.marketCache = {
        key: cacheKey,
        fetchedAt,
        snapshot
      };
    }

    if (!snapshot) return;
    renderMarketSnapshot(snapshot);
  } catch {
    if (state.marketCache.snapshot) {
      state.marketCache.snapshot = {
        ...state.marketCache.snapshot,
        sources: {
          ...state.marketCache.snapshot.sources,
          coingecko: "Cached",
          xrpl: state.marketCache.snapshot.sources?.xrpl || "Cached"
        }
      };
      renderMarketSnapshot(state.marketCache.snapshot);
      return;
    }
    if (refs.marketPrice) refs.marketPrice.textContent = "Loading...";
    if (refs.marketVolume) refs.marketVolume.textContent = "Loading...";
    if (refs.marketCap) refs.marketCap.textContent = "Loading...";
    if (refs.marketLedgerIndex) refs.marketLedgerIndex.textContent = "Loading...";
    if (refs.marketTps) refs.marketTps.textContent = "Loading...";
    if (refs.marketFee) refs.marketFee.textContent = "Loading...";
    if (refs.xrpPriceStat) refs.xrpPriceStat.textContent = "Loading...";
    if (refs.xrpChangeStat) refs.xrpChangeStat.textContent = "Loading...";
    if (refs.xrpNavPrice) refs.xrpNavPrice.textContent = "-";
    renderMarketSourceStatus(null, "Loading");
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
  if (refs.commandXummModeHint) refs.commandXummModeHint.textContent = xummSignInGuidance();
  if (refs.commandXummSignInButton && !refs.commandXummSignInButton.disabled) {
    refs.commandXummSignInButton.textContent = xummSignInButtonLabel();
  }

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
  const issuer = token.issuer || "";
  const currency = decodeCurrencyCode(token.currency || symbol);
  const id = token.slug || watchKey([issuer, token.currency || currency]);
  return {
    rank: index + 1,
    symbol,
    currency,
    rawCurrency: token.currency || currency,
    issuer,
    id,
    priceUsd: toFiniteNumber(token.usd, Number.NaN),
    change24h: toFiniteNumber(token.pro24h ?? token.p24h, Number.NaN),
    marketCap: toFiniteNumber(token.marketcap, Number.NaN),
    holders: toFiniteNumber(token.holders, Number.NaN),
    trustlines: toFiniteNumber(token.trustlines, Number.NaN),
    volume24h: toFiniteNumber(token.vol24hxrp ?? token.vol24h, Number.NaN),
    holderConcentration: toFiniteNumber(token.top10 ?? token.top20 ?? token.top50, Number.NaN),
    lowLiquidity: Boolean(token.lowLiquidity),
    freezeFlag: Boolean(token.globalFreeze || token.freeze || token.frozen || token.canFreeze),
    verified: Boolean(token.verified || token.kyc),
    logoUrl: tokenLogoUrl(token),
    slug: token.slug || "",
    md5: String(token.md5 || token._id || "").trim(),
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

function watchKey(parts = []) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(":");
}

function getStoredWatchlist(key) {
  try {
    const values = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function storeWatchlist(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // Local persistence is optional.
  }
}

function toggleWatchlist(type, id) {
  if (!id) return;
  const set = type === "amm" ? state.ammWatchlist : state.tokenWatchlist;
  const storageKey = type === "amm" ? STORAGE_KEYS.ammWatchlist : STORAGE_KEYS.tokenWatchlist;
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  storeWatchlist(storageKey, set);
  if (type === "amm") {
    renderTopAmmPools();
  } else {
    renderTopIssuedTokens();
  }
}

function watchButtonMarkup(type, id, isWatched) {
  const attr = type === "amm" ? "data-watch-amm" : "data-watch-token";
  return `<button class="ghost table-link watch-toggle ${isWatched ? "is-watched" : ""}" type="button" ${attr}="${escapeHtml(id)}">${isWatched ? "Watching" : "Watch"}</button>`;
}

function riskBadgeMarkup(level, reasons = []) {
  const normalized = String(level || "Tracked");
  const className = normalized === "Lower Risk" ? "verified"
    : normalized === "High Risk" ? "danger"
      : normalized === "Medium Risk" ? "warning"
        : "";
  const title = reasons.length ? ` title="${escapeHtml(reasons.join(" | "))}"` : "";
  const detail = reasons.length
    ? `<span class="market-risk-reasons">${escapeHtml(reasons.slice(0, 2).join(" • "))}</span>`
    : "";
  return `<span class="market-token-badge ${className}"${title}>${escapeHtml(normalized)}</span>${detail}`;
}

function scoreIssuedAssetRisk(token = {}) {
  const reasons = [];
  let score = 0;
  if (!token.verified) {
    score += 2;
    reasons.push("Unverified issuer");
  } else {
    reasons.push("Verified issuer");
  }
  if (Number.isFinite(token.trustlines) && token.trustlines < 250) {
    score += 1;
    reasons.push("Low trust line count");
  }
  if (Number.isFinite(token.holders) && token.holders < 150) {
    score += 1;
    reasons.push("Low holder count");
  }
  if (Number.isFinite(token.volume24h) && token.volume24h < 1000) {
    score += 1;
    reasons.push("Thin 24h volume");
  }
  if (Number.isFinite(token.holderConcentration) && token.holderConcentration >= 80) {
    score += 2;
    reasons.push("High holder concentration");
  }
  if (token.lowLiquidity) {
    score += 2;
    reasons.push("Low liquidity flag");
  }
  if (token.freezeFlag) {
    score += 2;
    reasons.push("Issuer freeze flag");
  }
  const level = score >= 4 ? "High Risk" : score >= 2 ? "Medium Risk" : "Lower Risk";
  return { level, score, reasons };
}

function scoreAmmPoolRisk(pool = {}) {
  const reasons = [];
  let score = 0;
  if (!pool.verified) {
    score += 1;
    reasons.push("Unverified paired asset");
  }
  if (pool.lowLiquidity || (Number.isFinite(pool.tvl) && pool.tvl < 50000)) {
    score += 2;
    reasons.push("Low TVL/liquidity");
  }
  if (Number.isFinite(pool.volume24hAmm) && pool.volume24hAmm < 1000) {
    score += 1;
    reasons.push("Thin AMM volume");
  }
  if (Number.isFinite(pool.lpHolders) && pool.lpHolders < 50) {
    score += 1;
    reasons.push("Few LP holders");
  }
  if (Number.isFinite(pool.lpBurnedPercent) && pool.lpBurnedPercent > 40) {
    score += 1;
    reasons.push("Large LP burn concentration");
  }
  const level = score >= 4 ? "High Risk" : score >= 2 ? "Medium Risk" : "Lower Risk";
  return { level, score, reasons };
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

  const visibleItems = filteredItems.slice(0, state.topIssuedVisibleCount);
  const rows = visibleItems.map((token) => {
    const changeClass = Number.isFinite(token.change24h) && token.change24h >= 0 ? "positive" : "negative";
    const sourceUrl = token.slug ? `https://xrpl.to/token/${encodeURIComponent(token.slug)}` : "";
    const risk = scoreIssuedAssetRisk(token);
    const watched = state.tokenWatchlist.has(token.id);
    return `
      <tr>
        <td class="rank-cell">${token.rank}</td>
        <td>
          <div class="market-token-identity">
            ${tokenLogoMarkup(token, token.symbol)}
            <div>
              <strong>${escapeHtml(token.symbol)}</strong>
              <span>${escapeHtml(formatAddress(token.issuer))}</span>
            </div>
          </div>
        </td>
        <td>${formatUsd(token.priceUsd)}</td>
        <td class="${changeClass}">${formatPercent(token.change24h)}</td>
        <td>${formatUsd(token.marketCap)}</td>
        <td>${formatCompactNumber(token.holders, 1)}</td>
        <td>${formatCompactNumber(token.trustlines, 1)}</td>
        <td>${formatCompactNumber(token.volume24h, 1)} XRP</td>
        <td>${token.verified ? '<span class="market-token-badge verified">Verified</span>' : '<span class="market-token-badge">Unverified</span>'}</td>
        <td>${riskBadgeMarkup(risk.level, risk.reasons)}</td>
        <td>${watchButtonMarkup("token", token.id, watched)}</td>
        <td>${sourceUrl ? `<a class="ghost table-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">View</a>` : "-"}</td>
      </tr>
    `;
  }).join("");

  refs.topIssuedTokensPanel.innerHTML = `
    <div class="market-token-summary">
      <div><span>Showing</span><strong>${visibleItems.length}/${filteredItems.length}</strong></div>
      <div><span>Combined Market Cap</span><strong>${formatUsd(totalMarketCap)}</strong></div>
      <div><span>Holder Count</span><strong>${formatCompactNumber(totalHolders, 1)}</strong></div>
      <div><span>Updated</span><strong>${updatedLabel}</strong></div>
    </div>
    <label class="market-token-filter">
      <span>Filter assets</span>
      <input id="topIssuedTokenFilter" type="search" placeholder="Search symbol or issuer..." value="${escapeHtml(state.topIssuedFilter)}" autocomplete="off" />
    </label>
    ${error ? `<p class="market-token-note">${escapeHtml(error)} Showing cached data where available.</p>` : ""}
    <div class="issued-token-table-wrap" role="region" aria-label="XRPL issued assets" tabindex="0">
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
            <th>Risk</th>
            <th>Watch</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="12" class="empty-table-cell">No issued assets match this filter.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="market-load-row">
      <span>${items.length} assets loaded from the market feed. ${state.tokenWatchlist.size} watched.</span>
      ${visibleItems.length < filteredItems.length
        ? `<button id="loadMoreTopIssuedTokensButton" class="ghost" type="button">Load ${Math.min(MARKET_VISIBLE_STEP, filteredItems.length - visibleItems.length)} more</button>`
        : '<span class="market-load-complete">All matching assets shown</span>'}
    </div>
  `;

  const filterInput = refs.topIssuedTokensPanel.querySelector("#topIssuedTokenFilter");
  filterInput?.addEventListener("input", (event) => {
    state.topIssuedFilter = event.target.value || "";
    state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;
    renderTopIssuedTokens();
  });

  const loadMoreButton = refs.topIssuedTokensPanel.querySelector("#loadMoreTopIssuedTokensButton");
  loadMoreButton?.addEventListener("click", () => {
    state.topIssuedVisibleCount = Math.min(state.topIssuedVisibleCount + MARKET_VISIBLE_STEP, filteredItems.length);
    renderTopIssuedTokens();
  });

  refs.topIssuedTokensPanel.querySelectorAll("[data-watch-token]").forEach((button) => {
    button.addEventListener("click", () => toggleWatchlist("token", button.dataset.watchToken || ""));
  });
}

async function loadTopIssuedAssets(forceRefresh = false) {
  if (!refs.topIssuedTokensPanel || state.topIssuedAssets.loading) return;
  if (forceRefresh) state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;

  if (!forceRefresh && state.topIssuedAssets.items.length) {
    renderTopIssuedTokens();
    renderDex();
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
    renderDex();
    return;
  }

  state.topIssuedAssets.loading = true;
  state.topIssuedAssets.error = "";
  renderTopIssuedTokens();

  try {
    const data = await fetchMarketJson(TOP_ISSUED_ASSETS_URL);
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const items = tokens.slice(0, MARKET_RESULT_LIMIT).map(normalizeIssuedAssetMarketToken);
    state.topIssuedAssets = {
      fetchedAt: Date.now(),
      items,
      loading: false,
      error: ""
    };
    setCachedTopIssuedAssets(items);
    syncXrplToSourceStatus("Cached");
  } catch (error) {
    const cachedFallback = getCachedTopIssuedAssets();
    state.topIssuedAssets = {
      fetchedAt: cachedFallback?.fetchedAt || 0,
      items: cachedFallback?.items || state.topIssuedAssets.items || [],
      loading: false,
      error: error?.status === 429
        ? "Market API rate limit reached. Showing cached data when available."
        : error instanceof Error ? error.message : "Could not load issued asset market data."
    };
    if (cachedFallback?.items?.length || state.topIssuedAssets.items.length) {
      syncXrplToSourceStatus("Cached");
    } else {
      syncXrplToSourceStatus("Degraded");
    }
  }

  renderTopIssuedTokens();
  renderDex();
}

function normalizeAmmPoolMarketToken(token = {}, index = 0) {
  const symbol = decodeCurrencyCode(token.name || token.currency || "");
  const issuer = token.issuer || "";
  const currency = decodeCurrencyCode(token.currency || symbol);
  const id = token.AMM || token.slug || watchKey([issuer, token.currency || currency, "amm"]);
  return {
    rank: index + 1,
    symbol,
    currency,
    issuer,
    id,
    ammAccount: token.AMM || "",
    tvl: toFiniteNumber(token.tvl, Number.NaN),
    volume24hAmm: toFiniteNumber(token.vol24hxrpAMM ?? token.vol24hAMM, Number.NaN),
    tradingFee: toFiniteNumber(token.tradingFee, Number.NaN),
    lpHolders: toFiniteNumber(token.lpHolderCount, Number.NaN),
    lpBurnedPercent: toFiniteNumber(token.lpBurnedPercent, Number.NaN),
    holders: toFiniteNumber(token.holders, Number.NaN),
    trustlines: toFiniteNumber(token.trustlines, Number.NaN),
    lowLiquidity: Boolean(token.lowLiquidity),
    verified: Boolean(token.verified || token.kyc),
    logoUrl: tokenLogoUrl(token),
    slug: token.slug || ""
  };
}

function getCachedTopAmmPools() {
  try {
    const cached = JSON.parse(localStorage.getItem(TOP_AMM_POOLS_CACHE_KEY) || "null");
    if (!cached?.items?.length || !cached.fetchedAt) return null;
    if (Date.now() - cached.fetchedAt > TOP_AMM_POOLS_CACHE_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function setCachedTopAmmPools(items) {
  try {
    localStorage.setItem(TOP_AMM_POOLS_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      items
    }));
  } catch {
    // Cache is optional.
  }
}

function renderTopAmmPools() {
  if (!refs.topAmmPoolsPanel) return;
  const { items, loading, error, fetchedAt } = state.topAmmPools;
  if (refs.refreshTopAmmPoolsButton) {
    refs.refreshTopAmmPoolsButton.disabled = loading;
    refs.refreshTopAmmPoolsButton.textContent = loading ? "Loading..." : "Refresh";
  }

  if (!items.length && loading) {
    refs.topAmmPoolsPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>Loading top AMM / LP pools...</strong>
        <p class="muted">Fetching TVL, AMM volume, trading fee, LP holder, and trust line data.</p>
      </div>
    `;
    return;
  }

  if (!items.length) {
    refs.topAmmPoolsPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>${error ? "Top AMM / LP pools unavailable" : "Top AMM / LP pools loading soon"}</strong>
        <p class="muted">${error ? escapeHtml(error) : "Live XRPL AMM pool data will appear here."}</p>
      </div>
    `;
    return;
  }

  const query = state.topAmmFilter.trim().toLowerCase();
  const filteredItems = query
    ? items.filter((pool) =>
        pool.symbol.toLowerCase().includes(query)
        || pool.currency.toLowerCase().includes(query)
        || pool.issuer.toLowerCase().includes(query)
        || pool.ammAccount.toLowerCase().includes(query)
      )
    : items;

  const totalTvl = items.reduce((sum, pool) => sum + (Number.isFinite(pool.tvl) ? pool.tvl : 0), 0);
  const totalAmmVolume = items.reduce((sum, pool) => sum + (Number.isFinite(pool.volume24hAmm) ? pool.volume24hAmm : 0), 0);
  const totalLpHolders = items.reduce((sum, pool) => sum + (Number.isFinite(pool.lpHolders) ? pool.lpHolders : 0), 0);
  const updatedLabel = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "cached";

  const visibleItems = filteredItems.slice(0, state.topAmmVisibleCount);
  const rows = visibleItems.map((pool) => {
    const sourceUrl = pool.slug ? `https://xrpl.to/token/${encodeURIComponent(pool.slug)}` : "";
    const ammUrl = pool.ammAccount ? `https://xrpscan.com/account/${encodeURIComponent(pool.ammAccount)}` : "";
    const risk = scoreAmmPoolRisk(pool);
    const watched = state.ammWatchlist.has(pool.id);
    const status = pool.lowLiquidity
      ? '<span class="market-token-badge warning">Low Liquidity</span>'
      : pool.verified
        ? '<span class="market-token-badge verified">Verified</span>'
        : '<span class="market-token-badge">Tracked</span>';
    return `
      <tr>
        <td class="rank-cell">${pool.rank}</td>
        <td>
          <div class="market-token-identity">
            ${tokenLogoMarkup(pool, pool.symbol)}
            <div>
              <strong>${escapeHtml(pool.symbol)} / XRP</strong>
              <span>Issuer ${escapeHtml(formatAddress(pool.issuer))}</span>
            </div>
          </div>
        </td>
        <td>
          <strong>${escapeHtml(formatAddress(pool.ammAccount))}</strong>
          <span>AMM account</span>
        </td>
        <td>${formatUsd(pool.tvl)}</td>
        <td>${formatCompactNumber(pool.volume24hAmm, 1)} XRP</td>
        <td>${formatAmmFee(pool.tradingFee)}</td>
        <td>${formatCompactNumber(pool.lpHolders, 1)}</td>
        <td>${formatUnsignedPercent(pool.lpBurnedPercent)}</td>
        <td>${formatCompactNumber(pool.holders, 1)}</td>
        <td>${formatCompactNumber(pool.trustlines, 1)}</td>
        <td>${status}</td>
        <td>${riskBadgeMarkup(risk.level, risk.reasons)}</td>
        <td>${watchButtonMarkup("amm", pool.id, watched)}</td>
        <td>
          <div class="table-link-stack">
            ${sourceUrl ? `<a class="ghost table-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">Token</a>` : ""}
            ${ammUrl ? `<a class="ghost table-link" href="${ammUrl}" target="_blank" rel="noopener noreferrer">Pool</a>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  refs.topAmmPoolsPanel.innerHTML = `
    <div class="market-token-summary amm-market-summary">
      <div><span>Showing</span><strong>${visibleItems.length}/${filteredItems.length}</strong></div>
      <div><span>Combined TVL</span><strong>${formatUsd(totalTvl)}</strong></div>
      <div><span>24h AMM Volume</span><strong>${formatCompactNumber(totalAmmVolume, 1)} XRP</strong></div>
      <div><span>LP Holders</span><strong>${formatCompactNumber(totalLpHolders, 1)}</strong></div>
      <div><span>Updated</span><strong>${updatedLabel}</strong></div>
    </div>
    <label class="market-token-filter">
      <span>Filter pools</span>
      <input id="topAmmPoolFilter" type="search" placeholder="Search pair, issuer, or AMM account..." value="${escapeHtml(state.topAmmFilter)}" autocomplete="off" />
    </label>
    ${error ? `<p class="market-token-note">${escapeHtml(error)} Showing cached data where available.</p>` : ""}
    <div class="issued-token-table-wrap amm-pool-table-wrap" role="region" aria-label="XRPL AMM and LP pools" tabindex="0">
      <table class="issued-token-table amm-pool-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Pool Pair</th>
            <th>AMM Account</th>
            <th>TVL</th>
            <th>24h AMM Volume</th>
            <th>Fee</th>
            <th>LP Holders</th>
            <th>LP Burned</th>
            <th>Holders</th>
            <th>Trust Lines</th>
            <th>Status</th>
            <th>Risk</th>
            <th>Watch</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="14" class="empty-table-cell">No AMM pools match this filter.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="market-load-row">
      <span>${items.length} AMM / LP pools loaded from the market feed. ${state.ammWatchlist.size} watched.</span>
      ${visibleItems.length < filteredItems.length
        ? `<button id="loadMoreTopAmmPoolsButton" class="ghost" type="button">Load ${Math.min(MARKET_VISIBLE_STEP, filteredItems.length - visibleItems.length)} more</button>`
        : '<span class="market-load-complete">All matching pools shown</span>'}
    </div>
  `;

  const filterInput = refs.topAmmPoolsPanel.querySelector("#topAmmPoolFilter");
  filterInput?.addEventListener("input", (event) => {
    state.topAmmFilter = event.target.value || "";
    state.topAmmVisibleCount = MARKET_VISIBLE_STEP;
    renderTopAmmPools();
  });

  const loadMoreButton = refs.topAmmPoolsPanel.querySelector("#loadMoreTopAmmPoolsButton");
  loadMoreButton?.addEventListener("click", () => {
    state.topAmmVisibleCount = Math.min(state.topAmmVisibleCount + MARKET_VISIBLE_STEP, filteredItems.length);
    renderTopAmmPools();
  });

  refs.topAmmPoolsPanel.querySelectorAll("[data-watch-amm]").forEach((button) => {
    button.addEventListener("click", () => toggleWatchlist("amm", button.dataset.watchAmm || ""));
  });
}

async function loadTopAmmPools(forceRefresh = false) {
  if (!refs.topAmmPoolsPanel || state.topAmmPools.loading) return;
  if (forceRefresh) state.topAmmVisibleCount = MARKET_VISIBLE_STEP;

  if (!forceRefresh && state.topAmmPools.items.length) {
    renderTopAmmPools();
    return;
  }

  const backoffUntil = state.topAmmPools.backoffUntil || 0;
  const cached = !forceRefresh ? getCachedTopAmmPools() : null;
  if (cached) {
    state.topAmmPools = {
      fetchedAt: cached.fetchedAt,
      items: cached.items,
      loading: false,
      error: "",
      backoffUntil
    };
    renderTopAmmPools();
    return;
  }

  if (backoffUntil > Date.now()) {
    const seconds = Math.ceil((backoffUntil - Date.now()) / 1000);
    state.topAmmPools.error = `AMM market API rate limit reached. Retry in about ${seconds} seconds.`;
    renderTopAmmPools();
    return;
  }

  state.topAmmPools.loading = true;
  state.topAmmPools.error = "";
  renderTopAmmPools();

  try {
    const data = await fetchMarketJson(TOP_AMM_POOLS_URL);
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const items = tokens
      .filter((token) => token.AMM || Number.parseFloat(token.tvl || "0") > 0)
      .slice(0, MARKET_RESULT_LIMIT)
      .map(normalizeAmmPoolMarketToken);
    state.topAmmPools = {
      fetchedAt: Date.now(),
      items,
      loading: false,
      error: "",
      backoffUntil: 0
    };
    setCachedTopAmmPools(items);
    syncXrplToSourceStatus("Cached");
  } catch (error) {
    const cachedFallback = getCachedTopAmmPools();
    if (error?.status === 429) {
      state.topAmmPools.backoffUntil = Date.now() + TOP_AMM_POOLS_BACKOFF_MS;
    }
    state.topAmmPools = {
      fetchedAt: cachedFallback?.fetchedAt || 0,
      items: cachedFallback?.items || state.topAmmPools.items || [],
      loading: false,
      error: error?.status === 429
        ? "AMM market API rate limit reached. Showing cached data when available."
        : error instanceof Error ? error.message : "Could not load AMM / LP pool market data.",
      backoffUntil: state.topAmmPools.backoffUntil || backoffUntil
    };
    if (cachedFallback?.items?.length || state.topAmmPools.items.length) {
      syncXrplToSourceStatus("Cached");
    } else {
      syncXrplToSourceStatus("Degraded");
    }
  }

  renderTopAmmPools();
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

// ── DEX helpers ──────────────────────────────────────────────────

function setDexTicketStatus(msg, isError = false) {
  if (!refs.dexTicketStatus) return;
  refs.dexTicketStatus.textContent = msg;
  refs.dexTicketStatus.classList.toggle("error", isError);
}

function decimalString(n, decimals = 6) {
  return Number.isFinite(n) ? n.toFixed(decimals).replace(/\.?0+$/, "") || "0" : "0";
}

function dexTokenOptions() {
  return state.topIssuedAssets.items.slice(0, 50);
}

function getDexSelectedToken() {
  const id = state.dex.selectedTokenId;
  if (!id) return null;
  return dexTokenOptions().find((t) => t.id === id) || null;
}

function estimateDexXrpPrice() {
  const { bids, asks } = state.dex.orderBook;
  if (asks.length) return asks[0].price;
  if (bids.length) return bids[0].price;
  return 0;
}

function populateDexAssetSelect() {
  if (!refs.dexAssetSelect) return;
  const options = dexTokenOptions();
  const current = refs.dexAssetSelect.value;
  const firstOption = refs.dexAssetSelect.options[0];
  const placeholder = firstOption && firstOption.value === "" ? firstOption : new Option("Select a top issued asset", "");
  refs.dexAssetSelect.innerHTML = "";
  refs.dexAssetSelect.append(placeholder);
  options.forEach((token) => {
    const label = `${token.symbol} — ${token.issuer.slice(0, 8)}…`;
    refs.dexAssetSelect.append(new Option(label, token.id));
  });
  if (current) refs.dexAssetSelect.value = current;
}

function applyDexToken(token) {
  if (!token) return;
  state.dex.currency = token.currency;
  state.dex.issuer = token.issuer;
  if (refs.dexCurrencyInput) refs.dexCurrencyInput.value = token.currency;
  if (refs.dexIssuerInput) refs.dexIssuerInput.value = token.issuer;
}

function syncDexStateFromInputs() {
  state.dex.currency = refs.dexCurrencyInput?.value.trim() || "";
  state.dex.issuer = refs.dexIssuerInput?.value.trim() || "";
  state.dex.amount = refs.dexAmountInput?.value || "";
  state.dex.price = refs.dexPriceInput?.value || "";
  state.dex.side = refs.dexSideSelect?.value || "buy";
  state.dex.orderStyle = refs.dexOrderStyleSelect?.value || "limit";
  state.dex.slippage = refs.dexSlippageInput?.value || "1";
  state.dex.stopLoss = refs.dexStopLossInput?.value || "";
  state.dex.takeProfit = refs.dexTakeProfitInput?.value || "";
}

function dexIssuedAsset() {
  return { currency: state.dex.currency, issuer: state.dex.issuer, value: state.dex.amount };
}

function dexXrpAsset() {
  const xrp = toFiniteNumber(state.dex.amount, 0) * toFiniteNumber(state.dex.price, 0);
  return xrpToDrops(decimalString(xrp, 6));
}

function xrplAmountNumber(amount) {
  if (typeof amount === "string") return toFiniteNumber(amount, 0) / 1e6;
  if (amount && typeof amount === "object") return toFiniteNumber(amount.value, 0);
  return 0;
}

function normalizeDexBookOffer(offer, side) {
  const takerGets = xrplAmountNumber(offer.taker_gets);
  const takerPays = xrplAmountNumber(offer.taker_pays);
  const price = side === "asks"
    ? (takerGets > 0 ? takerPays / takerGets : 0)
    : (takerPays > 0 ? takerGets / takerPays : 0);
  return { price, amount: side === "asks" ? takerGets : takerPays, raw: offer };
}

function dexOrderStats() {
  const { bids, asks } = state.dex.orderBook;
  if (!bids.length && !asks.length) return null;
  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  const spread = bestAsk - bestBid;
  const spreadPct = bestBid > 0 ? (spread / bestBid) * 100 : 0;
  const midPrice = (bestBid + bestAsk) / 2 || bestBid || bestAsk;
  const bidDepth = bids.reduce((sum, o) => sum + o.amount, 0);
  const askDepth = asks.reduce((sum, o) => sum + o.amount, 0);
  return { bestBid, bestAsk, spread, spreadPct, midPrice, bidDepth, askDepth };
}

function buildDexOfferTx() {
  const { side, orderStyle, currency, issuer } = state.dex;
  if (!currency || !issuer) return null;
  const amount = toFiniteNumber(state.dex.amount, 0);
  const price = toFiniteNumber(state.dex.price, 0);
  if (amount <= 0 || price <= 0) return null;

  const xrpDrops = xrpToDrops(decimalString(amount * price, 6));
  const issuedValue = decimalString(amount, 6);

  let flags = 0;
  if (orderStyle === "passive") flags |= OFFER_CREATE_FLAGS.passive;
  if (orderStyle === "ioc") flags |= OFFER_CREATE_FLAGS.ioc;
  if (orderStyle === "fok") flags |= OFFER_CREATE_FLAGS.ioc | OFFER_CREATE_FLAGS.fok;

  const walletState = getWalletState();
  const tx = {
    TransactionType: "OfferCreate",
    Account: walletState.publicAddress || "",
    Flags: flags
  };

  if (side === "buy") {
    tx.TakerGets = xrpDrops;
    tx.TakerPays = { currency, issuer, value: issuedValue };
  } else {
    tx.TakerGets = { currency, issuer, value: issuedValue };
    tx.TakerPays = xrpDrops;
  }

  return tx;
}

function dexPreviewFromTx(tx) {
  if (!tx) return null;
  const gets = typeof tx.TakerGets === "string"
    ? `${(Number(tx.TakerGets) / 1e6).toFixed(6)} XRP`
    : `${tx.TakerGets.value} ${tx.TakerGets.currency}`;
  const pays = typeof tx.TakerPays === "string"
    ? `${(Number(tx.TakerPays) / 1e6).toFixed(6)} XRP`
    : `${tx.TakerPays.value} ${tx.TakerPays.currency}`;
  return {
    side: state.dex.side === "buy" ? "BUY" : "SELL",
    takerGets: gets,
    takerPays: pays,
    orderStyle: state.dex.orderStyle,
    price: state.dex.price,
    currency: state.dex.currency,
    issuer: state.dex.issuer,
    slippage: state.dex.slippage,
    stopLoss: state.dex.stopLoss,
    takeProfit: state.dex.takeProfit,
    account: tx.Account
  };
}

function renderDexTxPreview(preview) {
  const el = document.getElementById("txPreview");
  if (!el) return;
  if (!preview) {
    el.innerHTML = `<p class="muted">Fill the trade ticket and click Analyze Trade to see the transaction preview.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="dex-preview-grid">
      <div class="dex-preview-row"><span class="dex-label">Direction</span><span class="chip chip-${preview.side === "BUY" ? "safe" : "medium"}">${preview.side}</span></div>
      <div class="dex-preview-row"><span class="dex-label">TakerGets</span><span>${preview.takerGets}</span></div>
      <div class="dex-preview-row"><span class="dex-label">TakerPays</span><span>${preview.takerPays}</span></div>
      <div class="dex-preview-row"><span class="dex-label">Order Style</span><span>${preview.orderStyle}</span></div>
      <div class="dex-preview-row"><span class="dex-label">Limit Price</span><span>${preview.price} XRP per token</span></div>
      <div class="dex-preview-row"><span class="dex-label">Slippage Guard</span><span>${preview.slippage}%</span></div>
      ${preview.stopLoss ? `<div class="dex-preview-row"><span class="dex-label">Stop Loss</span><span>${preview.stopLoss} XRP</span></div>` : ""}
      ${preview.takeProfit ? `<div class="dex-preview-row"><span class="dex-label">Take Profit</span><span>${preview.takeProfit} XRP</span></div>` : ""}
      <div class="dex-preview-row"><span class="dex-label">Account</span><span class="mono">${preview.account || "—"}</span></div>
    </div>
  `;
}

function renderDexAccessPanel() {
  if (!refs.dexPagePanel) return;
  if (hasSigningWallet()) {
    const walletState = getWalletState();
    refs.dexPagePanel.innerHTML = `
      <div class="dex-access-connected">
        <span class="chip chip-safe">Connected</span>
        <span class="muted">${walletState.publicAddress || ""}</span>
      </div>
    `;
  } else {
    refs.dexPagePanel.innerHTML = `
      <p><strong>DEX locked:</strong> Connect Xumm/Xaman or load a wallet created in IkeLedger to sign transactions.</p>
      <p class="muted">You can analyze and preview trades without signing, but submitting requires a signing wallet.</p>
      <div class="button-row">
        <button id="dexAuthPromptButton" type="button">Sign In / Connect</button>
        <button class="ghost profile-wallet-nav-btn" data-nav="create-wallet" type="button">Create Wallet</button>
      </div>
    `;
    refs.dexPagePanel.querySelector("#dexAuthPromptButton")?.addEventListener("click", openAuthModal);
    refs.dexPagePanel.querySelectorAll(".profile-wallet-nav-btn[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => setActivePage(btn.dataset.nav));
    });
  }
  if (refs.dexAccessBadge) {
    refs.dexAccessBadge.textContent = hasSigningWallet() ? "Connected" : "Wallet required";
    refs.dexAccessBadge.classList.toggle("chip-safe", hasSigningWallet());
  }
}

function renderDexStatsPanel() {
  if (!refs.dexStatsPanel) return;
  const stats = dexOrderStats();
  const { loading, error, updatedAt } = state.dex.orderBook;

  if (loading) {
    refs.dexStatsPanel.innerHTML = `<p class="muted">Loading order book…</p>`;
    if (refs.dexBookUpdated) refs.dexBookUpdated.textContent = "Loading…";
    return;
  }
  if (error) {
    refs.dexStatsPanel.innerHTML = `<p class="error">${error}</p>`;
    if (refs.dexBookUpdated) refs.dexBookUpdated.textContent = "Error";
    return;
  }
  if (!stats) {
    refs.dexStatsPanel.innerHTML = `<p class="muted">No order book data. Select a token and click Refresh Book.</p>`;
    if (refs.dexBookUpdated) refs.dexBookUpdated.textContent = "Not loaded";
    return;
  }

  refs.dexStatsPanel.innerHTML = `
    <div class="dex-stat"><span class="dex-label">Best Bid</span><span>${decimalString(stats.bestBid, 6)} XRP</span></div>
    <div class="dex-stat"><span class="dex-label">Best Ask</span><span>${decimalString(stats.bestAsk, 6)} XRP</span></div>
    <div class="dex-stat"><span class="dex-label">Spread</span><span>${decimalString(stats.spread, 6)} XRP (${decimalString(stats.spreadPct, 2)}%)</span></div>
    <div class="dex-stat"><span class="dex-label">Mid Price</span><span>${decimalString(stats.midPrice, 6)} XRP</span></div>
    <div class="dex-stat"><span class="dex-label">Bid Depth</span><span>${formatCompactNumber(stats.bidDepth)}</span></div>
    <div class="dex-stat"><span class="dex-label">Ask Depth</span><span>${formatCompactNumber(stats.askDepth)}</span></div>
  `;

  if (refs.dexBookUpdated) {
    refs.dexBookUpdated.textContent = updatedAt
      ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
      : "Not loaded";
  }
}

function renderDexOrderBookPanel() {
  if (!refs.dexOrderBookPanel) return;
  const { bids, asks, loading } = state.dex.orderBook;
  if (loading) {
    refs.dexOrderBookPanel.innerHTML = `<p class="muted">Loading…</p>`;
    return;
  }
  if (!bids.length && !asks.length) {
    refs.dexOrderBookPanel.innerHTML = `<p class="muted">No book data. Select a token and refresh.</p>`;
    return;
  }
  const rowHtml = (items, cls) => items.slice(0, 8).map((o) =>
    `<div class="book-row ${cls}"><span>${decimalString(o.price, 6)}</span><span>${formatCompactNumber(o.amount)}</span></div>`
  ).join("");
  const mid = dexOrderStats()?.midPrice;
  refs.dexOrderBookPanel.innerHTML = `
    <div class="book-header"><span>Price (XRP)</span><span>Amount</span></div>
    <div class="book-asks">${rowHtml(asks, "ask")}</div>
    ${mid ? `<div class="book-mid">${decimalString(mid, 6)} mid</div>` : ""}
    <div class="book-bids">${rowHtml(bids, "bid")}</div>
  `;
}

function renderDexRiskRewardPanel() {
  if (!refs.dexRiskRewardPanel) return;
  const { price, stopLoss, takeProfit, slippage, amount, side } = state.dex;
  const entry = toFiniteNumber(price, 0);
  const sl = toFiniteNumber(stopLoss, 0);
  const tp = toFiniteNumber(takeProfit, 0);
  const qty = toFiniteNumber(amount, 0);

  if (!entry || !qty) {
    refs.dexRiskRewardPanel.innerHTML = `<p class="muted">Enter price and amount to see risk/reward metrics.</p>`;
    return;
  }

  const riskXrp = sl > 0 && side === "buy" ? (entry - sl) * qty : 0;
  const rewardXrp = tp > 0 && side === "buy" ? (tp - entry) * qty : 0;
  const rrRatio = riskXrp > 0 ? (rewardXrp / riskXrp).toFixed(2) : "—";
  const totalCost = entry * qty;
  const slipAmt = totalCost * (toFiniteNumber(slippage, 1) / 100);

  refs.dexRiskRewardPanel.innerHTML = `
    <div class="dex-stat"><span class="dex-label">Entry Price</span><span>${decimalString(entry, 6)} XRP</span></div>
    <div class="dex-stat"><span class="dex-label">Total Cost</span><span>${decimalString(totalCost, 4)} XRP</span></div>
    ${sl > 0 ? `<div class="dex-stat"><span class="dex-label">Risk (stop-loss)</span><span style="color:var(--color-error,#ef4444)">${decimalString(riskXrp, 4)} XRP</span></div>` : ""}
    ${tp > 0 ? `<div class="dex-stat"><span class="dex-label">Reward (take-profit)</span><span style="color:var(--color-success,#22c55e)">${decimalString(rewardXrp, 4)} XRP</span></div>` : ""}
    <div class="dex-stat"><span class="dex-label">R/R Ratio</span><span>${rrRatio}</span></div>
    <div class="dex-stat"><span class="dex-label">Slippage Allowance</span><span>${decimalString(slipAmt, 4)} XRP (${slippage}%)</span></div>
  `;
}

// ── Trading chart — indicator math ───────────────────────────────

function chartSma(data, n) {
  return data.map((_, i) => {
    if (i < n - 1) return NaN;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += data[j];
    return s / n;
  });
}

function chartEma(data, n) {
  const k = 2 / (n + 1);
  const out = new Array(data.length).fill(NaN);
  let sum = 0, cnt = 0, started = false, prev = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (!started) {
      sum += v;
      cnt++;
      if (cnt === n) { prev = sum / n; out[i] = prev; started = true; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function chartBB(closes, n = 20, mult = 2) {
  const mid = chartSma(closes, n);
  return closes.map((_, i) => {
    if (!Number.isFinite(mid[i])) return { mid: NaN, upper: NaN, lower: NaN };
    let variance = 0;
    for (let j = i - n + 1; j <= i; j++) variance += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(variance / n);
    return { mid: mid[i], upper: mid[i] + mult * sd, lower: mid[i] - mult * sd };
  });
}

function chartRsi(closes, n = 14) {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= n) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= n; al /= n;
  for (let i = n; i < closes.length; i++) {
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    if (i < closes.length - 1) {
      const d = closes[i + 1] - closes[i];
      ag = (ag * (n - 1) + Math.max(d, 0)) / n;
      al = (al * (n - 1) + Math.max(-d, 0)) / n;
    }
  }
  return out;
}

// ── Trading chart — data fetching ─────────────────────────────────

function dexTfParams(tf) {
  // Each timeframe = candle period (TradingView convention), limit = bars fetched
  if (tf === "5M")  return { krakenInterval: 5,     xrplPeriod: "5m",  limit: 500 };  // ~40h
  if (tf === "15M") return { krakenInterval: 15,    xrplPeriod: "15m", limit: 500 };  // ~5 days
  if (tf === "1H")  return { krakenInterval: 60,    xrplPeriod: "1h",  limit: 720 };  // 30 days
  if (tf === "4H")  return { krakenInterval: 240,   xrplPeriod: "4h",  limit: 500 };  // ~80 days
  if (tf === "1W")  return { krakenInterval: 10080, xrplPeriod: "1w",  limit: 200 };  // ~4 years
  return                   { krakenInterval: 1440,  xrplPeriod: "1d",  limit: 730 };  // 1D: ~2 years
}

async function fetchDexChartData(token, tf = "1D") {
  const { krakenInterval, xrplPeriod, limit } = dexTfParams(tf);

  if (!token) {
    // XRP/USD — Kraken public API (CORS-friendly, XRP is native so not on xrpl.to)
    const candles = await fetchKrakenXrpOhlcv(krakenInterval, limit);
    if (!candles.length) throw new Error("No XRP/USD data from Kraken.");
    return { candles, label: `XRP / USD — ${tf}` };
  }

  // ── Issued token — multi-source OHLCV with XRPL live fallback ────
  const { md5, slug, rawCurrency, issuer, symbol, currency } = token;
  const chartLabel = `${symbol || currency} / XRP — ${tf}`;

  const parseOhlcv = (raw) =>
    (Array.isArray(raw) ? raw : []).map((k) => {
      if (Array.isArray(k)) {
        const [t, o, h, l, c, v = 0] = k;
        return { t: toFiniteNumber(t, 0), o: toFiniteNumber(o, 0), h: toFiniteNumber(h, 0), l: toFiniteNumber(l, 0), c: toFiniteNumber(c, 0), v: toFiniteNumber(v, 0) };
      }
      return { t: toFiniteNumber(k.t ?? k.time ?? k.date ?? k.timestamp ?? 0, 0), o: toFiniteNumber(k.o ?? k.open ?? 0, 0), h: toFiniteNumber(k.h ?? k.high ?? 0, 0), l: toFiniteNumber(k.l ?? k.low ?? 0, 0), c: toFiniteNumber(k.c ?? k.close ?? k.last ?? 0, 0), v: toFiniteNumber(k.v ?? k.vol ?? k.volume ?? k.base_volume ?? k.counter_volume ?? 0, 0) };
    }).filter((c) => c.c > 0);

  const tryFetch = async (url) => {
    const data = await fetchMarketJson(url);
    return parseOhlcv(Array.isArray(data) ? data : (data?.data ?? data?.ohlcv ?? data?.result ?? []));
  };

  // Source 1 — xrpl.to by currency+issuer (xrpl.to requires decoded code, not 40-char hex)
  const urlCurrency = currency || symbol; // decoded form (e.g. "CULT" not "43554C54...")
  if (urlCurrency && issuer) {
    try {
      const c = await tryFetch(`https://api.xrpl.to/v1/tokens/${encodeURIComponent(urlCurrency)}+${encodeURIComponent(issuer)}/ohlcv?period=${xrplPeriod}&limit=${limit}`);
      if (c.length) return { candles: c, label: chartLabel };
    } catch { /* try next */ }
  }

  // Source 2 — xrpl.to by md5 hash (when available and is a real 32-char hex)
  if (md5 && /^[a-f0-9]{32}$/i.test(md5)) {
    try {
      const c = await tryFetch(`https://api.xrpl.to/v1/tokens/${md5}/ohlcv?period=${xrplPeriod}&limit=${limit}`);
      if (c.length) return { candles: c, label: chartLabel };
    } catch { /* try next */ }
  }

  // Source 3 — XRPL ledger live price via amm_info + book_offers (no history — single point)
  const livePrice = await fetchTokenSpotFromXrpl(token);
  if (livePrice > 0) {
    const now = Date.now();
    return {
      candles: [{ t: now, o: livePrice, h: livePrice, l: livePrice, c: livePrice, v: 0 }],
      label: `${chartLabel} · live only`
    };
  }

  throw new Error(`No chart data for ${symbol || currency}. The token may have low trading volume.`);
}

async function fetchTokenSpotFromXrpl(token) {
  const walletState = getWalletState();
  const network = walletState.network || DEFAULT_NETWORK;
  const { rawCurrency, issuer } = token;
  if (!rawCurrency || !issuer) return 0;

  // Try AMM pool first (amm_info — XRPL native)
  try {
    const result = await requestXrplCommand(network, {
      command: "amm_info",
      asset:  { currency: "XRP" },
      asset2: { currency: rawCurrency, issuer }
    });
    const amm = result?.amm;
    if (amm) {
      const xrp   = Number(amm.amount || 0) / 1e6;
      const token = Number(amm.amount2?.value || 0);
      if (xrp > 0 && token > 0) return xrp / token;
    }
  } catch { /* fall through */ }

  // Fallback: best ask from book_offers (XRPL native order book)
  try {
    const result = await requestXrplCommand(network, {
      command: "book_offers",
      taker_pays: { currency: "XRP" },
      taker_gets: { currency: rawCurrency, issuer },
      limit: 5
    });
    const offers = result?.offers || [];
    if (offers.length) {
      const o = offers[0];
      const xrp   = Number(o.TakerPays || 0) / 1e6;
      const tok   = Number(o.TakerGets?.value || 0);
      if (xrp > 0 && tok > 0) return xrp / tok;
    }
  } catch { /* */ }

  return 0;
}

let _dexChartLoadId = 0; // incremented on every load; stale results are discarded

async function loadDexChart(force = false) {
  const token = getDexSelectedToken();
  const tokenId = token?.id || "";
  const tf = state.dex.chart.timeframe;
  const cacheKey = `${tokenId}:${tf}`;

  if (
    !force
    && state.dex.chart.cacheKey === cacheKey
    && state.dex.chart.fetchedAt
    && Date.now() - state.dex.chart.fetchedAt < 5 * 60 * 1000
  ) return;

  const myId = ++_dexChartLoadId;
  state.dex.chart.loading = true;
  state.dex.chart.error = "";
  state.dex.chart.cacheKey = cacheKey;
  state.dex.chart.tokenId = tokenId;
  drawDexAnalysisChart();

  try {
    const { candles, label } = await fetchDexChartData(token, tf);
    if (myId !== _dexChartLoadId) return; // superseded by a newer selection
    state.dex.chart = {
      ...state.dex.chart,
      candles,
      label,
      loading: false,
      error: "",
      cacheKey,
      tokenId,
      fetchedAt: Date.now()
    };
    dexChartBarsVis = Math.min(80, candles.length);
    dexChartOffset  = 0;
  } catch (err) {
    if (myId !== _dexChartLoadId) return;
    state.dex.chart.loading = false;
    state.dex.chart.error = err instanceof Error ? err.message : "Chart unavailable.";
    state.dex.chart.candles = [];
  }

  drawDexAnalysisChart();
}

// ── Trading chart — controls injection (runs once per session) ────

let dexChartReady    = false;
let dexMouseX        = -1;
let dexMouseY        = -1;
let dexChartBarsVis  = 60;    // zoom: how many candles are visible
let dexChartOffset   = 0;     // pan: bars from right edge that are scrolled past
let dexChartDragging = false;
let dexChartDragX    = 0;
let dexChartDragOff  = 0;

function ensureDexChartControls() {
  if (dexChartReady) return;
  const canvas = refs.dexAnalysisChart;
  const shell = canvas?.parentElement;
  if (!shell) return;
  dexChartReady = true;

  const { timeframe, chartType, indicators } = state.dex.chart;

  // ── Controls bar ──────────────────────────────────────────────
  const ctrl = document.createElement("div");
  ctrl.className = "dex-chart-controls";
  ctrl.innerHTML = `
    <div class="dex-ctrl-group dex-asset-picker-group">
      <button class="dex-asset-btn" title="Change chart asset">XRP / USD ▾</button>
      <div class="dex-asset-dropdown hidden">
        <input type="text" class="dex-asset-search" placeholder="Search token…" autocomplete="off">
        <div class="dex-asset-list"></div>
      </div>
    </div>
    <div class="dex-ctrl-divider"></div>
    <div class="dex-ctrl-group">
      ${["5M","15M","1H","4H","1D","1W"].map((tf) =>
        `<button class="dex-tf-btn${tf === timeframe ? " is-active" : ""}" data-tf="${tf}">${tf}</button>`
      ).join("")}
    </div>
    <div class="dex-ctrl-divider"></div>
    <div class="dex-ctrl-group">
      ${[["candle","Candles"],["ohlc","Bars"],["line","Line"],["area","Area"]].map(([t,l]) =>
        `<button class="dex-type-btn${t === chartType ? " is-active" : ""}" data-type="${t}">${l}</button>`
      ).join("")}
    </div>
    <div class="dex-ctrl-divider"></div>
    <div class="dex-ctrl-group dex-ind-group">
      ${[["ma20","MA 20"],["ma50","MA 50"],["ema20","EMA 20"],["bb","BB"],["volume","Vol"],["rsi","RSI"]].map(([k,l]) =>
        `<label class="dex-ind-label"><input type="checkbox" data-ind="${k}"${indicators[k] ? " checked" : ""}><span>${l}</span></label>`
      ).join("")}
    </div>
    <div class="dex-ctrl-divider"></div>
    <div class="dex-ctrl-group">
      <button class="dex-fit-btn" title="Fit all data">↔</button>
    </div>
  `;
  shell.insertBefore(ctrl, canvas);

  // ── Asset picker ───────────────────────────────────────────────
  const assetBtn      = ctrl.querySelector(".dex-asset-btn");
  const assetDropdown = ctrl.querySelector(".dex-asset-dropdown");
  const assetSearch   = ctrl.querySelector(".dex-asset-search");
  const assetList     = ctrl.querySelector(".dex-asset-list");

  function renderAssetList(filter = "") {
    const q = filter.toLowerCase();
    const items = [
      { id: "", label: "XRP / USD", sub: "Native — Kraken data" },
      ...state.topIssuedAssets.items
        .filter((t) => !q || t.name?.toLowerCase().includes(q) || t.symbol?.toLowerCase().includes(q) || t.currency?.toLowerCase().includes(q))
        .slice(0, 30)
        .map((t) => ({ id: t.id || t.md5 || "", label: `${t.symbol || t.currency} / XRP`, sub: t.name || t.issuer || "" }))
    ];
    assetList.innerHTML = items.map((it) =>
      `<div class="dex-asset-item${it.id === (state.dex.selectedTokenId || "") ? " is-active" : ""}" data-id="${it.id}">
        <span class="dex-asset-item-label">${it.label}</span>
        <span class="dex-asset-item-sub">${it.sub}</span>
      </div>`
    ).join("");
  }

  assetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    assetDropdown.classList.toggle("hidden");
    if (!assetDropdown.classList.contains("hidden")) {
      renderAssetList();
      assetSearch.focus();
    }
  });
  assetSearch.addEventListener("input", () => renderAssetList(assetSearch.value));
  assetList.addEventListener("click", (e) => {
    const item = e.target.closest(".dex-asset-item");
    if (!item) return;
    const id = item.dataset.id;
    state.dex.selectedTokenId = id;
    if (!id) {
      assetBtn.textContent = "XRP / USD ▾";
      state.dex.currency = ""; state.dex.issuer = "";
    } else {
      const tok = state.topIssuedAssets.items.find((t) => (t.id || t.md5 || "") === id);
      if (tok) {
        assetBtn.textContent = `${tok.symbol || tok.currency} / XRP ▾`;
        applyDexToken(tok);
      }
    }
    assetDropdown.classList.add("hidden");
    assetSearch.value = "";
    clearTimeout(_tfDebounce);
    _tfDebounce = setTimeout(() => void loadDexChart(true), 350);
  });
  document.addEventListener("click", () => assetDropdown.classList.add("hidden"));

  // ── Timeframe buttons ──────────────────────────────────────────
  let _tfDebounce;
  ctrl.querySelectorAll(".dex-tf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dex.chart.timeframe = btn.dataset.tf;
      ctrl.querySelectorAll(".dex-tf-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      clearTimeout(_tfDebounce);
      _tfDebounce = setTimeout(() => void loadDexChart(true), 350);
    });
  });

  // ── Chart type buttons ─────────────────────────────────────────
  ctrl.querySelectorAll(".dex-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dex.chart.chartType = btn.dataset.type;
      ctrl.querySelectorAll(".dex-type-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      drawDexAnalysisChart();
    });
  });

  // ── Indicator checkboxes ───────────────────────────────────────
  ctrl.querySelectorAll("[data-ind]").forEach((cb) => {
    cb.addEventListener("change", () => {
      state.dex.chart.indicators[cb.dataset.ind] = cb.checked;
      drawDexAnalysisChart();
    });
  });

  // ── Fit button ─────────────────────────────────────────────────
  ctrl.querySelector(".dex-fit-btn")?.addEventListener("click", () => {
    const total = state.dex.chart.candles.length;
    dexChartBarsVis = total || 60;
    dexChartOffset  = 0;
    drawDexAnalysisChart();
  });

  // ── Canvas: crosshair (mouse position) ────────────────────────
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    dexMouseX = (e.clientX - r.left) * (canvas.width / r.width);
    dexMouseY = (e.clientY - r.top) * (canvas.height / r.height);
    if (dexChartDragging) {
      const dxPx    = e.clientX - dexChartDragX;
      const plotPx  = Math.max(r.width - 76, 1); // plot area in CSS pixels (W - RP - LP)
      const barsPerPx = dexChartBarsVis / plotPx;
      const delta   = Math.round(-dxPx * barsPerPx);
      const total   = state.dex.chart.candles.length;
      dexChartOffset = Math.max(0, Math.min(Math.max(0, total - dexChartBarsVis), dexChartDragOff + delta));
    }
    drawDexAnalysisChart();
  });
  canvas.addEventListener("mouseleave", () => {
    if (!dexChartDragging) { dexMouseX = -1; dexMouseY = -1; }
    drawDexAnalysisChart();
  });

  // ── Canvas: drag to pan ────────────────────────────────────────
  canvas.addEventListener("mousedown", (e) => {
    dexChartDragging = true;
    dexChartDragX    = e.clientX;
    dexChartDragOff  = dexChartOffset;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    if (dexChartDragging) {
      dexChartDragging = false;
      canvas.style.cursor = "crosshair";
    }
  });

  // ── Canvas: scroll wheel to zoom ───────────────────────────────
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const total = state.dex.chart.candles.length;
    if (!total) return;
    const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
    dexChartBarsVis = Math.round(Math.max(5, Math.min(total, dexChartBarsVis * factor)));
    dexChartOffset  = Math.max(0, Math.min(total - dexChartBarsVis, dexChartOffset));
    drawDexAnalysisChart();
  }, { passive: false });

  // ── Touch: pinch zoom + swipe pan ─────────────────────────────
  let touchDist0 = 0, touchOff0 = 0, touchX0 = 0;
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDist0 = Math.hypot(dx, dy);
      touchOff0  = dexChartBarsVis;
    } else if (e.touches.length === 1) {
      touchX0   = e.touches[0].clientX;
      dexChartDragOff = dexChartOffset;
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const total = state.dex.chart.candles.length;
      if (touchDist0 > 0 && total) {
        dexChartBarsVis = Math.round(Math.max(5, Math.min(total, touchOff0 * (touchDist0 / dist))));
        dexChartOffset  = Math.max(0, Math.min(total - dexChartBarsVis, dexChartOffset));
        drawDexAnalysisChart();
      }
    } else if (e.touches.length === 1) {
      const dxPx   = e.touches[0].clientX - touchX0;
      const tr     = canvas.getBoundingClientRect();
      const plotPx = Math.max(tr.width - 76, 1);
      const delta  = Math.round(-dxPx * (dexChartBarsVis / plotPx));
      const total  = state.dex.chart.candles.length;
      dexChartOffset = Math.max(0, Math.min(Math.max(0, total - dexChartBarsVis), dexChartDragOff + delta));
      drawDexAnalysisChart();
    }
  }, { passive: false });
}

// ── Trading chart — draw ──────────────────────────────────────────

function drawDexAnalysisChart() {
  const canvas = refs.dexAnalysisChart;
  if (!(canvas instanceof HTMLCanvasElement)) return;

  ensureDexChartControls();

  const { loading, error, label } = state.dex.chart;

  // ── Viewport: slice candles based on zoom + pan ───────────────
  const allCandles = state.dex.chart.candles;
  const totalBars  = allCandles.length;
  const barsVis    = Math.max(5, Math.min(totalBars || 5, dexChartBarsVis));
  const viewOff    = Math.max(0, Math.min(Math.max(0, totalBars - barsVis), dexChartOffset));
  const startIdx   = Math.max(0, totalBars - barsVis - viewOff);
  const endIdx     = Math.max(0, totalBars - viewOff);
  const candles    = allCandles.slice(startIdx, endIdx || undefined);

  // ── Layout constants ──────────────────────────────────────────
  const { volume, rsi } = state.dex.chart.indicators;
  const INFO = 36;   // top OHLCV info bar
  const MAIN = 380;  // main price area
  const SUB  = 80;   // volume / RSI sub-panel height
  const XBAR = 24;   // bottom time axis
  const LP   = 4;    // left margin (tiny — axis is on right)
  const RP   = 72;   // right price axis width

  const dpr   = window.devicePixelRatio || 1;
  const W     = Math.max((canvas.parentElement?.clientWidth || 900), 300);
  const H     = INFO + MAIN + (volume ? SUB : 0) + (rsi ? SUB : 0) + XBAR;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const mainTop    = INFO;
  const mainBottom = INFO + MAIN;
  const volTop     = mainBottom;
  const volBottom  = volTop + (volume ? SUB : 0);
  const rsiTop     = volume ? volBottom : mainBottom;
  const rsiBottom  = rsiTop + (rsi ? SUB : 0);
  const xTop       = rsi ? rsiBottom : (volume ? volBottom : mainBottom);
  const plotL      = LP;
  const plotR      = W - RP;

  // ── TradingView color palette ─────────────────────────────────
  const C = {
    bg:       "#131722",
    panelBg:  "#131722",
    axisStrip:"#1a2035",
    grid:     "rgba(255,255,255,0.038)",
    sep:      "rgba(255,255,255,0.07)",
    axisText: "#848e9c",
    candleUp:   "#26a69a",
    candleDown: "#ef5350",
    fillUp:   "rgba(38,166,154,0.88)",
    fillDown: "rgba(239,83,80,0.88)",
    volUp:    "rgba(38,166,154,0.4)",
    volDown:  "rgba(239,83,80,0.4)",
    lineBlue: "#2962ff",
    ma20:     "#f6c85b",
    ma50:     "#7b7fdb",
    ema20:    "#f06292",
    bb:       "#9966cc",
    rsiLine:  "#c084fc",
  };

  // ── Background ────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Right Y-axis strip
  ctx.fillStyle = C.axisStrip;
  ctx.fillRect(plotR, 0, RP, H);

  // Bottom X-axis strip
  ctx.fillStyle = C.axisStrip;
  ctx.fillRect(0, xTop, W, XBAR);

  if (loading) {
    ctx.fillStyle = C.axisText;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Loading chart data…", (plotL + plotR) / 2, mainTop + MAIN / 2);
    return;
  }
  if (!candles.length) {
    ctx.fillStyle = C.axisText;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(error || "Open the DEX page to load chart data", (plotL + plotR) / 2, mainTop + MAIN / 2 - 8);
    if (error) {
      ctx.font = "10px system-ui";
      ctx.fillText("Try a different timeframe or wait a moment for rate limits to clear.", (plotL + plotR) / 2, mainTop + MAIN / 2 + 12);
    }
    return;
  }

  // Live-price-only fallback — single flat candle, no historical data
  const isLiveOnly = candles.length === 1 && candles[0].o === candles[0].h && candles[0].h === candles[0].l && candles[0].l === candles[0].c;
  if (isLiveOnly) {
    const liveP = candles[0].c;
    const midX  = (plotL + plotR) / 2;
    const midY  = (mainTop + mainBottom) / 2;
    ctx.strokeStyle = C.lineBlue; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(plotL, midY); ctx.lineTo(plotR, midY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.lineBlue; ctx.font = "bold 15px system-ui"; ctx.textAlign = "center";
    ctx.fillText(`${decimalString(liveP, liveP < 0.001 ? 8 : 6)} XRP`, midX, midY - 18);
    ctx.fillStyle = C.axisText; ctx.font = "11px system-ui";
    ctx.fillText("Live price — no OHLCV history on xrpl.to for this token", midX, midY + 14);
    ctx.fillText("Low volume tokens may not have tracked trade history.", midX, midY + 30);
    return;
  }

  // ── Core geometry ─────────────────────────────────────────────
  const closes  = candles.map((c) => c.c);
  const inds    = state.dex.chart.indicators;
  const ma20v   = inds.ma20  ? chartSma(closes, 20)   : [];
  const ma50v   = inds.ma50  ? chartSma(closes, 50)   : [];
  const ema20v  = inds.ema20 ? chartEma(closes, 20)   : [];
  const bbv     = inds.bb    ? chartBB(closes, 20, 2) : [];
  const rsiVals = inds.rsi   ? chartRsi(closes, 14)   : [];

  const allP = [
    ...candles.map((c) => c.h), ...candles.map((c) => c.l),
    ...(inds.ma20  ? ma20v.filter(Number.isFinite)                              : []),
    ...(inds.ma50  ? ma50v.filter(Number.isFinite)                              : []),
    ...(inds.ema20 ? ema20v.filter(Number.isFinite)                             : []),
    ...(inds.bb    ? bbv.flatMap((b) => [b.upper, b.lower]).filter(Number.isFinite) : [])
  ].filter(Number.isFinite);
  const rawMin = Math.min(...allP), rawMax = Math.max(...allP);
  const pad5   = (rawMax - rawMin) * 0.04 || rawMax * 0.01 || 0.0001;
  const minP   = rawMin - pad5, maxP = rawMax + pad5;
  const priceRange = maxP - minP || 1;

  const count = candles.length;
  // Future space: empty bars on the right when viewing the most recent data
  const futureBars  = viewOff === 0 ? Math.max(4, Math.round(count * 0.07)) : 0;
  const displaySlots = count + futureBars;
  const barW  = (plotR - plotL) / Math.max(displaySlots, 1);
  const bodyW = Math.max(barW * 0.7, 1);

  const toX   = (i) => plotL + i * barW + barW / 2;
  const mToY  = (p) => mainBottom - ((p - minP) / priceRange) * MAIN;
  const subToY = (v, t, b, lo, hi) => b - ((v - lo) / (hi - lo || 1)) * (b - t);

  // ── Vertical grid ─────────────────────────────────────────────
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  const vStep = Math.max(1, Math.floor(count / 7));
  candles.forEach((_, i) => {
    if (i % vStep !== 0) return;
    const x = toX(i);
    if (x < plotL + 16 || x > plotR - 16) return;
    ctx.beginPath();
    ctx.moveTo(x, mainTop);
    ctx.lineTo(x, xTop);
    ctx.stroke();
  });

  // ── Horizontal grid + right Y-axis labels ─────────────────────
  const GRID_N = 5;
  for (let i = 0; i <= GRID_N; i++) {
    const frac  = i / GRID_N;
    const price = maxP - frac * priceRange;
    const y     = mainTop + frac * MAIN;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    if (i > 0 && i < GRID_N) {
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
    }
    if (y >= mainTop + 4 && y <= mainBottom - 4) {
      const lbl = decimalString(price, price < 0.01 ? 6 : price < 1 ? 4 : 2);
      ctx.fillStyle = C.axisText;
      ctx.font = "10px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(lbl, plotR + 6, y + 3);
    }
  }

  // ── X-axis time labels ────────────────────────────────────────
  ctx.font = "10px system-ui"; ctx.textAlign = "center";
  candles.forEach((c, i) => {
    if (i % vStep !== 0) return;
    const x = toX(i);
    if (x < plotL + 28 || x > plotR - 28) return;
    const ms  = c.t > 1e12 ? c.t : c.t * 1000;
    const d   = new Date(ms);
    const tf  = state.dex.chart.timeframe;
    const lbl = (tf === "5M" || tf === "15M")
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : (tf === "1H" || tf === "4H")
        ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString([], { month: "short", day: "numeric" });
    ctx.fillStyle = C.axisText;
    ctx.fillText(lbl, x, xTop + 15);
  });

  // ── Bollinger Bands (drawn before price so candles render on top) ──
  if (inds.bb && bbv.length) {
    const fillP = new Path2D(); let uf = false;
    bbv.forEach((b, i) => {
      if (!Number.isFinite(b.upper)) return;
      if (!uf) { fillP.moveTo(toX(i), mToY(b.upper)); uf = true; }
      else fillP.lineTo(toX(i), mToY(b.upper));
    });
    for (let i = bbv.length - 1; i >= 0; i--) {
      if (Number.isFinite(bbv[i].lower)) fillP.lineTo(toX(i), mToY(bbv[i].lower));
    }
    fillP.closePath();
    ctx.fillStyle = "rgba(153,102,204,0.06)";
    ctx.fill(fillP);

    [[C.bb, "upper"],[C.bb, "lower"],["rgba(153,102,204,0.35)","mid"]].forEach(([col, key]) => {
      const p = new Path2D(); let s = false;
      bbv.forEach((b, i) => {
        if (!Number.isFinite(b[key])) return;
        if (!s) { p.moveTo(toX(i), mToY(b[key])); s = true; } else p.lineTo(toX(i), mToY(b[key]));
      });
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(p);
    });
    ctx.setLineDash([]);
  }

  // ── Price display ─────────────────────────────────────────────
  const type = state.dex.chart.chartType;

  if (type === "candle") {
    candles.forEach((c, i) => {
      const x   = toX(i);
      const up  = c.c >= c.o;
      const col = up ? C.candleUp : C.candleDown;
      const bTop = mToY(Math.max(c.o, c.c));
      const bBot = mToY(Math.min(c.o, c.c));
      const bH   = Math.max(bBot - bTop, 1);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, mToY(c.h)); ctx.lineTo(x, bTop);
      ctx.moveTo(x, bBot);      ctx.lineTo(x, mToY(c.l));
      ctx.stroke();
      ctx.fillStyle = up ? C.fillUp : C.fillDown;
      ctx.fillRect(x - bodyW / 2, bTop, bodyW, bH);
    });

  } else if (type === "ohlc") {
    candles.forEach((c, i) => {
      const x   = toX(i);
      const up  = c.c >= c.o;
      const lw  = Math.max(bodyW * 0.22, 1);
      ctx.strokeStyle = up ? C.candleUp : C.candleDown; ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x, mToY(c.h)); ctx.lineTo(x, mToY(c.l));
      ctx.moveTo(x - bodyW / 2, mToY(c.o)); ctx.lineTo(x, mToY(c.o));
      ctx.moveTo(x, mToY(c.c)); ctx.lineTo(x + bodyW / 2, mToY(c.c));
      ctx.stroke();
    });

  } else {
    const path = new Path2D(); let s = false;
    closes.forEach((p, i) => {
      const x = toX(i), y = mToY(p);
      if (!s) { path.moveTo(x, y); s = true; } else path.lineTo(x, y);
    });
    ctx.strokeStyle = C.lineBlue; ctx.lineWidth = 2; ctx.stroke(path);
    if (type === "area") {
      const fill = new Path2D(path);
      fill.lineTo(toX(closes.length - 1), mainBottom);
      fill.lineTo(toX(0), mainBottom);
      fill.closePath();
      const grad = ctx.createLinearGradient(0, mainTop, 0, mainBottom);
      grad.addColorStop(0, "rgba(41,98,255,0.24)");
      grad.addColorStop(1, "rgba(41,98,255,0.01)");
      ctx.fillStyle = grad; ctx.fill(fill);
    }
  }

  // ── Moving averages ───────────────────────────────────────────
  const drawLine = (vals, color) => {
    const p = new Path2D(); let s = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      if (!s) { p.moveTo(toX(i), mToY(v)); s = true; } else p.lineTo(toX(i), mToY(v));
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke(p);
  };
  if (inds.ma20  && ma20v.length)  drawLine(ma20v,  C.ma20);
  if (inds.ma50  && ma50v.length)  drawLine(ma50v,  C.ma50);
  if (inds.ema20 && ema20v.length) drawLine(ema20v, C.ema20);

  // ── Current price tag on right axis ──────────────────────────
  const lastClose = closes[closes.length - 1];
  if (Number.isFinite(lastClose)) {
    const cy  = mToY(lastClose);
    const lbl = decimalString(lastClose, lastClose < 0.01 ? 6 : lastClose < 1 ? 4 : 2);
    const lw  = Math.max(ctx.measureText(lbl).width + 10, RP - 2);
    const lastUp = closes.length >= 2 ? lastClose >= closes[closes.length - 2] : true;
    ctx.fillStyle = lastUp ? C.candleUp : C.candleDown;
    ctx.fillRect(plotR, cy - 9, lw, 18);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "left";
    ctx.fillText(lbl, plotR + 5, cy + 4);
  }

  // ── Overlay lines (entry / SL / TP / bid / ask) ───────────────
  const entry = toFiniteNumber(state.dex.price, 0);
  const sl    = toFiniteNumber(state.dex.stopLoss, 0);
  const tp    = toFiniteNumber(state.dex.takeProfit, 0);
  const sts   = dexOrderStats();
  const bid   = sts?.bestBid || 0;
  const ask   = sts?.bestAsk || 0;
  const clamp = (y) => Math.min(mainBottom - 9, Math.max(mainTop + 9, y));

  const drawOv = (price, color, lbl) => {
    const y = mToY(price);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // Tag on right axis
    const tag = decimalString(price, price < 0.01 ? 6 : 4);
    const tw  = Math.max(ctx.measureText(tag).width + 10, RP - 2);
    ctx.fillStyle = color;
    ctx.fillRect(plotR, clamp(y) - 9, tw, 18);
    ctx.fillStyle = "#fff"; ctx.font = "bold 9px monospace"; ctx.textAlign = "left";
    ctx.fillText(tag, plotR + 5, clamp(y) + 4);
    // Label inside chart
    ctx.fillStyle = color; ctx.font = "bold 9px system-ui";
    ctx.fillText(lbl, plotL + 4, clamp(y) - 2);
    ctx.restore();
  };
  if (bid > 0) drawOv(bid, "#848e9c", "Bid");
  if (ask > 0 && ask !== bid) drawOv(ask, "#848e9c", "Ask");
  if (entry > 0) drawOv(entry, C.lineBlue, "Entry");
  if (sl > 0)    drawOv(sl,    C.candleDown, "Stop Loss");
  if (tp > 0)    drawOv(tp,    C.candleUp,   "Take Profit");

  // ── Panel separator lines ─────────────────────────────────────
  ctx.strokeStyle = C.sep; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(plotL, mainBottom); ctx.lineTo(W, mainBottom); ctx.stroke();
  if (volume && rsi) {
    ctx.beginPath(); ctx.moveTo(plotL, volBottom); ctx.lineTo(W, volBottom); ctx.stroke();
  }
  // Right axis separator
  ctx.beginPath(); ctx.moveTo(plotR, 0); ctx.lineTo(plotR, xTop); ctx.stroke();
  // X-axis separator
  ctx.beginPath(); ctx.moveTo(0, xTop); ctx.lineTo(W, xTop); ctx.stroke();

  // ── Volume panel ─────────────────────────────────────────────
  if (volume) {
    const maxVol = Math.max(...candles.map((c) => c.v), 1);
    candles.forEach((c, i) => {
      if (!c.v) return;
      const x  = toX(i);
      const bH = Math.max((c.v / maxVol) * (SUB - 4), 1);
      ctx.fillStyle = c.c >= c.o ? C.volUp : C.volDown;
      ctx.fillRect(x - bodyW / 2, volBottom - bH, bodyW, bH);
    });
    ctx.fillStyle = C.axisText; ctx.font = "9px system-ui"; ctx.textAlign = "left";
    ctx.fillText("Volume", plotL + 4, volTop + 12);
  }

  // ── RSI panel ────────────────────────────────────────────────
  if (rsi && rsiVals.length) {
    const rsiH = SUB;
    [30, 50, 70].forEach((lvl) => {
      const y = rsiBottom - (lvl / 100) * rsiH;
      ctx.strokeStyle = lvl === 50 ? "rgba(255,255,255,0.06)" : "rgba(239,83,80,0.16)";
      ctx.lineWidth = 1; ctx.setLineDash(lvl === 50 ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.axisText; ctx.textAlign = "left"; ctx.font = "9px system-ui";
      ctx.fillText(String(lvl), plotR + 6, y + 3);
    });
    const rsiPath = new Path2D(); let rs = false;
    rsiVals.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const x = toX(i), y = rsiBottom - (v / 100) * rsiH;
      if (!rs) { rsiPath.moveTo(x, y); rs = true; } else rsiPath.lineTo(x, y);
    });
    ctx.strokeStyle = C.rsiLine; ctx.lineWidth = 1.5; ctx.stroke(rsiPath);

    const lastRsi = [...rsiVals].reverse().find(Number.isFinite);
    ctx.fillStyle = C.axisText; ctx.font = "9px system-ui"; ctx.textAlign = "left";
    ctx.fillText("RSI(14)", plotL + 4, rsiTop + 12);
    if (Number.isFinite(lastRsi)) {
      ctx.fillStyle = lastRsi > 70 ? C.candleDown : lastRsi < 30 ? C.candleUp : C.rsiLine;
      ctx.fillText(lastRsi.toFixed(1), plotL + 58, rsiTop + 12);
      // RSI value on right axis
      const ry = rsiBottom - (lastRsi / 100) * rsiH;
      ctx.fillStyle = C.axisText; ctx.textAlign = "left";
      ctx.fillText(lastRsi.toFixed(1), plotR + 6, ry + 3);
    }
  }

  // ── OHLCV info bar (top strip — updates with crosshair) ────────
  const hovIdx = (dexMouseX >= plotL && dexMouseX <= plotR)
    ? Math.min(Math.floor((dexMouseX - plotL) / barW), count - 1)
    : count - 1;
  const ic   = candles[Math.max(0, hovIdx)];
  const icUp = ic.c >= ic.o;
  const icChg = ic.o > 0 ? ((ic.c - ic.o) / ic.o * 100) : 0;
  const icMs  = ic.t > 1e12 ? ic.t : ic.t * 1000;
  const icD   = new Date(icMs);
  const icTf  = state.dex.chart.timeframe;
  const icTs  = (icTf === "5M" || icTf === "15M" || icTf === "1H" || icTf === "4H")
    ? icD.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : icD.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });

  ctx.font = "11px system-ui"; ctx.textAlign = "left";
  let ix = plotL + 6;
  const iy = 23;

  if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "bold 11px system-ui";
    ctx.fillText(label, ix, iy);
    ix += ctx.measureText(label).width + 14;
  }
  ctx.font = "11px system-ui";
  ctx.fillStyle = C.axisText; ctx.fillText(icTs + "  ", ix, iy);
  ix += ctx.measureText(icTs + "  ").width;
  [["O", ic.o],["H", ic.h],["L", ic.l],["C", ic.c]].forEach(([k, v]) => {
    ctx.fillStyle = C.axisText; ctx.fillText(k + " ", ix, iy);
    ix += ctx.measureText(k + " ").width;
    ctx.fillStyle = icUp ? C.candleUp : C.candleDown;
    const vs = decimalString(v, 6) + "  ";
    ctx.fillText(vs, ix, iy);
    ix += ctx.measureText(vs).width;
  });
  ctx.fillStyle = icUp ? C.candleUp : C.candleDown;
  ctx.fillText(`${icUp ? "+" : ""}${icChg.toFixed(2)}%`, ix, iy);
  if (ic.v > 0) {
    ctx.fillStyle = C.axisText;
    ix += ctx.measureText(`${icUp ? "+" : ""}${icChg.toFixed(2)}%`).width + 10;
    ctx.fillText("Vol " + formatCompactNumber(ic.v), ix, iy);
  }

  // Indicator legend dots
  let lx = plotL + 4, ly = mainTop + 14;
  ctx.font = "9px system-ui"; ctx.textAlign = "left";
  if (inds.ma20)  { ctx.fillStyle = C.ma20;  ctx.fillText("MA 20",  lx, ly); lx += 42; }
  if (inds.ma50)  { ctx.fillStyle = C.ma50;  ctx.fillText("MA 50",  lx, ly); lx += 42; }
  if (inds.ema20) { ctx.fillStyle = C.ema20; ctx.fillText("EMA 20", lx, ly); lx += 48; }
  if (inds.bb)    { ctx.fillStyle = C.bb;    ctx.fillText("BB(20)", lx, ly); }

  // ── Crosshair ────────────────────────────────────────────────
  const fullBottom = rsi ? rsiBottom : (volume ? volBottom : mainBottom);
  if (dexMouseX >= plotL && dexMouseX <= plotR && dexMouseY >= mainTop && dexMouseY <= fullBottom) {
    const mx = dexMouseX, my = dexMouseY;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, mainTop); ctx.lineTo(mx, fullBottom);
    ctx.moveTo(plotL, my);   ctx.lineTo(plotR, my);
    ctx.stroke();

    // Price tag on right axis (main panel)
    if (my >= mainTop && my <= mainBottom) {
      const price = minP + (1 - (my - mainTop) / MAIN) * priceRange;
      const plbl  = decimalString(price, price < 0.01 ? 6 : 4);
      const pw    = Math.max(ctx.measureText(plbl).width + 10, RP - 2);
      ctx.fillStyle = C.lineBlue;
      ctx.fillRect(plotR, my - 9, pw, 18);
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
      ctx.fillText(plbl, plotR + 5, my + 4);
    }

    // Time tag on bottom axis
    const bi  = Math.min(Math.floor((mx - plotL) / barW), count - 1);
    if (bi >= 0 && bi < count) {
      const bMs  = candles[bi].t > 1e12 ? candles[bi].t : candles[bi].t * 1000;
      const bD   = new Date(bMs);
      const bTf  = state.dex.chart.timeframe;
      const tLbl = (bTf === "1H" || bTf === "4H")
        ? bD.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : bD.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const tw = ctx.measureText(tLbl).width + 12;
      const tx = Math.min(Math.max(mx - tw / 2, plotL), plotR - tw);
      ctx.fillStyle = C.lineBlue;
      ctx.fillRect(tx, xTop + 1, tw, 20);
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px system-ui"; ctx.textAlign = "center";
      ctx.fillText(tLbl, tx + tw / 2, xTop + 15);
    }

    ctx.restore();
  }
}

function renderDexExecutionPlan() {
  if (!refs.dexExecutionPlanPanel) return;
  const { side, amount, price, stopLoss, takeProfit, currency } = state.dex;
  const entry = toFiniteNumber(price, 0);
  const qty = toFiniteNumber(amount, 0);
  const sl = toFiniteNumber(stopLoss, 0);
  const tp = toFiniteNumber(takeProfit, 0);

  if (!entry || !qty || !currency) {
    refs.dexExecutionPlanPanel.innerHTML = `<p class="muted">Complete the trade ticket to generate an execution plan.</p>`;
    return;
  }

  const steps = [
    `<strong>Step 1:</strong> Place ${side === "buy" ? "BUY" : "SELL"} OfferCreate for ${decimalString(qty, 4)} ${currency} at ${decimalString(entry, 6)} XRP/token via Xumm.`,
    `<strong>Step 2:</strong> Monitor XRPL ledger for offer fill status.`,
    sl > 0 ? `<strong>Step 3 (Stop-Loss):</strong> If price drops to ${decimalString(sl, 6)} XRP, manually place a SELL offer to exit.` : null,
    tp > 0 ? `<strong>Step ${sl > 0 ? 4 : 3} (Take-Profit):</strong> If price reaches ${decimalString(tp, 6)} XRP, manually place a SELL offer to lock in gains.` : null
  ].filter(Boolean);

  refs.dexExecutionPlanPanel.innerHTML = steps.map((s) => `<p>${s}</p>`).join("");
}

function renderDexSafetyPanel() {
  if (!refs.dexSafetyPanel) return;
  const { currency, issuer, slippage, orderStyle } = state.dex;
  const warnings = [];

  if (!issuer) warnings.push("No issuer set. Verify the token issuer before creating any offer.");
  if (toFiniteNumber(slippage, 0) > 5) warnings.push(`Slippage guard is ${slippage}% — high slippage increases fill risk at unfavorable prices.`);
  if (orderStyle === "fok" || orderStyle === "ioc") warnings.push(`${orderStyle.toUpperCase()} orders may not fill if liquidity is insufficient and will be cancelled automatically.`);
  if (currency && currency.length === 40) warnings.push("Currency uses a 40-char hex code — confirm you recognize this issuer address.");
  warnings.push("XRPL does not provide native stop-loss automation. Stop and take-profit levels are planning guides only.");
  warnings.push("All transactions are irreversible once validated on-ledger. Verify every field in Xumm before approving.");

  refs.dexSafetyPanel.innerHTML = warnings.map((w) => `<p class="warning-inline">&#x26A0; ${w}</p>`).join("");
}

function renderDex() {
  populateDexAssetSelect();
  renderDexAccessPanel();
  renderDexStatsPanel();
  renderDexOrderBookPanel();
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexExecutionPlan();
  renderDexSafetyPanel();
  renderDexTxPreview(state.dex.latestTx ? dexPreviewFromTx(state.dex.latestTx) : null);
  if (refs.dexSignOfferButton) refs.dexSignOfferButton.disabled = state.dex.signing;
}

async function loadDexOrderBook(force = false) {
  const { currency, issuer } = state.dex;
  if (!currency || !issuer) {
    setDexTicketStatus("Select an asset or enter currency and issuer before refreshing.", true);
    return;
  }
  if (!force && state.dex.orderBook.updatedAt && Date.now() - state.dex.orderBook.updatedAt < 10000) return;

  state.dex.orderBook.loading = true;
  state.dex.orderBook.error = "";
  renderDexStatsPanel();
  renderDexOrderBookPanel();

  const walletState = getWalletState();
  const network = walletState.network || DEFAULT_NETWORK;
  const takerPays = { currency: "XRP" };
  const takerGets = { currency, issuer };

  try {
    const [bidsResult, asksResult] = await Promise.all([
      requestXrplCommand(network, { command: "book_offers", taker_pays: takerPays, taker_gets: takerGets, limit: DEX_BOOK_LIMIT }),
      requestXrplCommand(network, { command: "book_offers", taker_pays: takerGets, taker_gets: takerPays, limit: DEX_BOOK_LIMIT })
    ]);
    state.dex.orderBook = {
      loading: false,
      error: "",
      bids: (bidsResult.offers || []).map((o) => normalizeDexBookOffer(o, "bids")),
      asks: (asksResult.offers || []).map((o) => normalizeDexBookOffer(o, "asks")),
      updatedAt: Date.now()
    };
  } catch (err) {
    state.dex.orderBook.loading = false;
    state.dex.orderBook.error = err instanceof Error ? err.message : "Order book request failed.";
  }

  renderDexStatsPanel();
  renderDexOrderBookPanel();
  drawDexAnalysisChart();
}

function onDexAssetChange() {
  const id = refs.dexAssetSelect?.value || "";
  state.dex.selectedTokenId = id;
  const token = getDexSelectedToken();
  applyDexToken(token);
  void loadDexChart(true);
  if (token) void loadDexOrderBook(true);
}

function onDexInputChange() {
  syncDexStateFromInputs();
  state.dex.latestTx = null;
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexExecutionPlan();
  renderDexSafetyPanel();
  renderDexTxPreview(null);
  setDexTicketStatus("");
}

function onDexAnalyze() {
  syncDexStateFromInputs();
  const { currency, issuer, amount, price } = state.dex;
  if (!currency) { setDexTicketStatus("Enter a currency code.", true); return; }
  if (!issuer) { setDexTicketStatus("Enter an issuer address.", true); return; }
  if (!(toFiniteNumber(amount, 0) > 0)) { setDexTicketStatus("Enter a token amount greater than zero.", true); return; }
  if (!(toFiniteNumber(price, 0) > 0)) { setDexTicketStatus("Enter a limit price greater than zero.", true); return; }

  const tx = buildDexOfferTx();
  if (!tx) { setDexTicketStatus("Could not build offer transaction. Check all fields.", true); return; }

  state.dex.latestTx = tx;
  renderDexTxPreview(dexPreviewFromTx(tx));
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexExecutionPlan();
  renderDexSafetyPanel();
  setDexTicketStatus("Transaction preview ready. Review all fields before signing.");
}

async function onDexSignOffer() {
  if (!hasSigningWallet()) {
    openAuthModal();
    return;
  }
  if (!state.dex.latestTx) {
    onDexAnalyze();
    if (!state.dex.latestTx) return;
  }

  state.dex.signing = true;
  if (refs.dexSignOfferButton) refs.dexSignOfferButton.disabled = true;
  setDexTicketStatus("Opening Xumm sign flow…");

  try {
    const xumm = initXumm();
    await createTxFlow(xumm, state.dex.latestTx);
    setDexTicketStatus("Xumm sign request sent. Approve in the Xumm/Xaman app.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signing failed.";
    if (msg.toLowerCase().includes("created") || msg.toLowerCase().includes("preview")) {
      setDexTicketStatus("This wallet was created in IkeLedger. Import it into Xumm/Xaman to sign transactions on-chain.", true);
    } else {
      setDexTicketStatus(msg, true);
    }
  } finally {
    state.dex.signing = false;
    if (refs.dexSignOfferButton) refs.dexSignOfferButton.disabled = false;
  }
}

function renderExtendedPanels(walletState) {
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
  renderTopAmmPools();
  renderValueMix(walletState);
  renderTxHistory(walletState);
  renderTxPreview(walletState);
  renderSecurity();
  renderAvatarStatus(walletState);
  renderFundWalletCard(walletState);
  void renderMarketOverview();
  renderExtendedPanels(walletState);
  renderDex();
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
  const mobile = isLikelyMobileDevice();
  setFeedback(mobile ? "Opening Xumm/Xaman on this device..." : "Opening Xumm sign in...");
  setCommandAuthStatus(mobile
    ? "Opening Xumm/Xaman. Approve the sign-in request, then return to IkeLedger."
    : "Opening Xumm sign in. Approve the request in Xaman to continue.");
  logSecurityEvent("xumm_signin_started", RISK_LEVELS.LOW, { context: "connect_wallet_button" });
  if (refs.connectXamanButton) refs.connectXamanButton.disabled = true;
  if (refs.commandXummSignInButton) refs.commandXummSignInButton.disabled = true;

  try {
    if (refs.commandXummSignInButton) refs.commandXummSignInButton.textContent = mobile ? "Opening Xumm..." : "Waiting for Xumm...";
    const xumm = await initXumm(getXamanApiKey());
    setCommandAuthStatus(mobile
      ? "Waiting for approval. If Xumm opened, complete the request there and come back here."
      : "Waiting for wallet approval in Xaman...");
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
      refs.commandXummSignInButton.textContent = xummSignInButtonLabel();
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

function setMarketProxyStatus(text, isError = false) {
  if (!refs.marketProxyStatus) return;
  refs.marketProxyStatus.textContent = text;
  refs.marketProxyStatus.style.color = isError ? "#ffb9c3" : "#a9ffe6";
}

function onSaveMarketProxy() {
  const value = refs.marketProxyUrlInput?.value.trim().replace(/\/$/, "") || "";
  if (!value) {
    localStorage.removeItem(STORAGE_KEYS.marketProxyBaseUrl);
    setMarketProxyStatus("Direct public APIs enabled.");
    return;
  }

  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Use http or https.");
    localStorage.setItem(STORAGE_KEYS.marketProxyBaseUrl, url.href.replace(/\/$/, ""));
    setMarketProxyStatus("Market proxy saved. Refresh market tables to use it.");
  } catch {
    setMarketProxyStatus("Enter a valid proxy URL, for example http://127.0.0.1:8788", true);
  }
}

function onClearMarketProxy() {
  localStorage.removeItem(STORAGE_KEYS.marketProxyBaseUrl);
  if (refs.marketProxyUrlInput) refs.marketProxyUrlInput.value = "";
  setMarketProxyStatus("Direct public APIs enabled.");
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
  bindClick(refs.refreshTopAmmPoolsButton, () => { void loadTopAmmPools(true); });

  // DEX controls
  refs.dexAssetSelect?.addEventListener("change", onDexAssetChange);
  const dexInputs = [refs.dexSideSelect, refs.dexCurrencyInput, refs.dexIssuerInput, refs.dexAmountInput, refs.dexPriceInput, refs.dexOrderStyleSelect, refs.dexSlippageInput, refs.dexStopLossInput, refs.dexTakeProfitInput];
  dexInputs.forEach((el) => {
    el?.addEventListener("input", onDexInputChange);
    el?.addEventListener("change", onDexInputChange);
  });
  bindClick(refs.dexAnalyzeButton, onDexAnalyze);
  bindClick(refs.dexRefreshBookButton, () => { void loadDexOrderBook(true); });
  bindClick(refs.dexSignOfferButton, () => { void onDexSignOffer(); });
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
  bindClick(refs.saveMarketProxyButton, onSaveMarketProxy);
  bindClick(refs.clearMarketProxyButton, onClearMarketProxy);
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
  state.tokenWatchlist = getStoredWatchlist(STORAGE_KEYS.tokenWatchlist);
  state.ammWatchlist = getStoredWatchlist(STORAGE_KEYS.ammWatchlist);
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "dark");
  setActivePage("dashboard");

  if (refs.networkSelect) refs.networkSelect.value = walletState.network;
  if (refs.addressInput) refs.addressInput.value = walletState.publicAddress || "";
  if (refs.supabaseUrlInput) refs.supabaseUrlInput.value = supabaseConfig.url;
  if (refs.supabaseAnonKeyInput) refs.supabaseAnonKeyInput.value = supabaseConfig.anonKey;
  if (refs.marketProxyUrlInput) refs.marketProxyUrlInput.value = localStorage.getItem(STORAGE_KEYS.marketProxyBaseUrl) || "";

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
}

boot();
