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
import { initXumm, signInWithXumm, waitForXummAccount, createTxFlow, resetXumm, clearXummSession } from "./ikeledger-xumm.js";
import {
  addXrplStreamHandler,
  ensureXrplConnection,
  fetchNftOfferSummaries,
  removeXrplStreamHandler,
  requestXrplCommand
} from "./ikeledger-xrpl.js";
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
const MARKET_RESULT_LIMIT = 200;
const MARKET_PAGE_SIZE    = 100;
const MARKET_VISIBLE_STEP = 50;
const LIVE_TOKEN_PRICE_VISIBLE_LIMIT = 12;
const LIVE_TOKEN_PRICE_STALE_MS = 2 * 60 * 1000;
const LIVE_TOKEN_PRICE_REFRESH_MS = 60 * 1000;
const MARKET_LIVE_CACHE_MS = 15 * 1000;
const MARKET_CHART_CACHE_MS = 5 * 60 * 1000;
const TOP_ISSUED_ASSETS_BASE_URL = "https://api.xrpl.to/v1/tokens?sortBy=marketcap&sortType=desc";
const TOP_AMM_POOLS_URL          = `https://api.xrpl.to/v1/tokens?sortBy=tvl&sortType=desc&limit=${MARKET_PAGE_SIZE}`;
const XRPL_TO_OHLC_BASE_URL = "https://api.xrpl.to/v1/ohlc";
const XRPL_TO_HISTORY_BASE_URL = "https://api.xrpl.to/v1/history";
const TOP_ISSUED_ASSETS_CACHE_KEY = "ike_top_issued_assets_v6";
const XRPSCAN_TOKENS_URL   = "https://api.xrpscan.com/api/v1/tokens?limit=500";
const XRPSCAN_CACHE_KEY    = "ike_xrpscan_tokens_v2";
const XRPSCAN_CACHE_MS     = 5 * 60 * 1000;
const TOP_AMM_POOLS_CACHE_KEY = "ike_top_amm_pools_v3";
const TOP_ISSUED_ASSETS_CACHE_MS = 6 * 60 * 60 * 1000;
const TOP_AMM_POOLS_CACHE_MS = 6 * 60 * 60 * 1000;
const TOP_AMM_POOLS_BACKOFF_MS = 5 * 60 * 1000;
const XUMM_MOBILE_PENDING_KEY = "ike_xumm_mobile_pending_v1";
const XUMM_MOBILE_PENDING_TTL_MS = 5 * 60 * 1000;
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
  xummResumeInFlight: false,
  latestPreview: null,
  rawJsonOpen: false,
  latestTxItems: [],
  activePage: "dashboard",
  selectedNftId: "",
  topIssuedFilter: "",
  topAmmFilter: "",
  topIssuedVisibleCount: MARKET_VISIBLE_STEP,
  topAmmVisibleCount: MARKET_VISIBLE_STEP,
  topIssuedTab: "all",
  topIssuedTagFilter: "",
  tokenWatchlist: new Set(),
  ammWatchlist: new Set(),
  chartTimeframe: "24H",
  marketTimer: null,
  marketCache: {
    key: "",
    fetchedAt: 0,
    snapshot: null,
    chartKey: "",
    chartFetchedAt: 0,
    points: []
  },
  nftOfferCache: new Map(),
  nftOfferLoading: new Set(),
  topIssuedAssets: {
    fetchedAt: 0,
    items: [],
    loading: false,
    error: "",
    livePrices: new Map(),   // tokenId → { priceXrp, source, fetchedAt }
    priceTimer: null
  },
  topAmmPools: {
    fetchedAt: 0,
    items: [],
    loading: false,
    error: "",
    backoffUntil: 0
  },
  ammTools: {
    selectedPoolId: "",
    depositValue: "1000",
    priceMovePct: "25",
    feeYieldPct: "2",
    exitPercent: "50",
    exitSlippagePct: "1"
  },
  dex: {
    selectedTokenId: "",
    side: "buy",
    currency: "",
    rawCurrency: "",
    issuer: "",
    amount: "",
    price: "",
    orderStyle: "limit",
    slippage: "1",
    stopLoss: "",
    takeProfit: "",
    latestTx: null,
    signing: false,
    customTokens: [],
    lookupResults: [],
    lookupLoading: false,
    lookupStatus: "",
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
      source: "",
      tokenId: "",
      cacheKey: "",
      fetchedAt: 0,
      timeframe: "1D",
      chartType: "candle",
      indicators: { ma20: true, ma50: true, ema20: false, vwap: false, bb: false, volume: true, rsi: false, macd: false }
    }
  },
  tracker: {
    wallets: [],           // [{ address, label, group }]
    groups: [],            // string[] of group names
    feed: [],              // [TrackerEvent]
    feedLimit: 150,
    running: false,
    txFilters: new Set(["health","security","token","nft","amm","market","whale","buy","sell","payment","offer","other"]),
    minXrp: 0,
    groupFilter: "",
    socialHandles: [],     // [{ handle, label }]
    alerts: []             // [{ type, value }]
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
  accentSelect: document.getElementById("accentSelect"),
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
  walletPageSummary: document.getElementById("walletPageSummary"),
  tokensPagePanel: document.getElementById("tokensPagePanel"),
  topIssuedTokensPanel: document.getElementById("topIssuedTokensPanel"),
  refreshTopIssuedTokensButton: document.getElementById("refreshTopIssuedTokensButton"),
  topAmmPoolsPanel: document.getElementById("topAmmPoolsPanel"),
  refreshTopAmmPoolsButton: document.getElementById("refreshTopAmmPoolsButton"),
  ammToolPoolSelect: document.getElementById("ammToolPoolSelect"),
  ammDepositValueInput: document.getElementById("ammDepositValueInput"),
  ammPriceMoveInput: document.getElementById("ammPriceMoveInput"),
  ammFeeYieldInput: document.getElementById("ammFeeYieldInput"),
  ammExitPercentInput: document.getElementById("ammExitPercentInput"),
  ammExitSlippageInput: document.getElementById("ammExitSlippageInput"),
  ammToolResults: document.getElementById("ammToolResults"),
  ammWhaleAlerts: document.getElementById("ammWhaleAlerts"),
  nftsPagePanel: document.getElementById("nftsPagePanel"),
  nftListingsPagePanel: document.getElementById("nftListingsPagePanel"),
  dexPagePanel: document.getElementById("dexPagePanel"),
  dexAccessBadge: document.getElementById("dexAccessBadge"),
  dexLookupInput: document.getElementById("dexLookupInput"),
  dexLookupButton: document.getElementById("dexLookupButton"),
  dexLookupResults: document.getElementById("dexLookupResults"),
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
  dexInsightPanel: document.getElementById("dexInsightPanel"),
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
  trackerPage: document.getElementById("trackerPage"),
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
  portfolioMoodInput: document.getElementById("portfolioMoodInput"),
  portfolioDensityInput: document.getElementById("portfolioDensityInput"),
  portfolioGlowInput: document.getElementById("portfolioGlowInput"),
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

function medianNumber(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
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

function formatAge(ms) {
  if (!ms || ms <= 0) return "—";
  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86_400_000);
  const hrs = Math.floor(diff / 3_600_000);
  const mins = Math.floor(diff / 60_000);
  const yrs = Math.floor(days / 365);
  const mos = Math.floor(days / 30);
  if (mins < 60) return `${mins}m`;
  if (hrs < 24) return `${hrs}h`;
  if (days < 30) return `${days}d`;
  if (mos < 12) {
    const remDays = days - mos * 30;
    return remDays > 3 ? `${mos}mo ${remDays}d` : `${mos}mo`;
  }
  const remMos = mos - yrs * 12;
  return remMos > 0 ? `${yrs}y ${remMos}mo` : `${yrs}y`;
}

function formatLedgerDate(value) {
  if (!value) return "recent";
  if (typeof value === "string" && Number.isNaN(Number(value))) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleDateString();
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return "recent";
  const unixMs = n > 1_000_000_000_000 ? n : (n + 946_684_800) * 1000;
  return new Date(unixMs).toLocaleDateString();
}

function formatXrpAmount(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) < 0.000001) return n.toExponential(2);
  if (Math.abs(n) < 0.0001) return n.toPrecision(3);
  if (Math.abs(n) < 1) return n.toFixed(4);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function pctChip(value) {
  const n = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(n)) return `<span class="pct-chip pct-neutral">—</span>`;
  const cls = n > 0 ? "pct-pos" : n < 0 ? "pct-neg" : "pct-neutral";
  const sign = n > 0 ? "+" : "";
  return `<span class="pct-chip ${cls}">${sign}${n.toFixed(1)}%</span>`;
}

function tokenSparklineSvg(token) {
  const w = 80, h = 30;
  const c7  = Number.isFinite(token.change7d)  ? token.change7d  : 0;
  const c24 = Number.isFinite(token.change24h) ? token.change24h : 0;
  const c1h = Number.isFinite(token.change1h)  ? token.change1h  : 0;
  const c5m = Number.isFinite(token.change5m)  ? token.change5m  : 0;
  const raw = [c7, (c7 + c24) / 2, c24, (c24 + c1h) / 2, c1h, (c1h + c5m) / 2, c5m];
  const min = Math.min(...raw), max = Math.max(...raw);
  const range = max - min || 0.01;
  const pad = 3, xStep = (w - pad * 2) / (raw.length - 1);
  const pts = raw.map((v, i) => ({
    x: +(pad + i * xStep).toFixed(1),
    y: +(pad + (1 - (v - min) / range) * (h - pad * 2)).toFixed(1)
  }));
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
    d += ` C${cpx},${pts[i - 1].y} ${cpx},${pts[i].y} ${pts[i].x},${pts[i].y}`;
  }
  const color = raw[raw.length - 1] >= raw[0] ? "#44d999" : "#ff5f6d";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" style="display:block"><path d="${d}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;
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
  // Trusted CDNs with open CORS — serve directly, no proxy needed
  if (clean.startsWith("https://s1.xrplmeta.org/")) return clean;
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

function tokenColor(symbol = "") {
  let h = 0;
  const s = String(symbol || "?");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const sat = 48 + (Math.abs(h >> 8) % 24);
  const lit = 32 + (Math.abs(h >> 16) % 20);
  return `hsl(${hue},${sat}%,${lit}%)`;
}

function tokenLogoUrl(token = {}) {
  const localLogo = String(token.localLogo || token.localLogoUrl || "").trim();
  if (localLogo.startsWith("./") || localLogo.startsWith("/")) return localLogo;

  // xrplmeta CDN (XRPScan-sourced) — directly accessible, highest priority
  const xrplmeta = String(token.xrplmetaIcon || "").trim();
  if (xrplmeta.startsWith("https://s1.xrplmeta.org/")) return xrplmeta;

  const directLogo = normalizeLogoSource(
    token.tomlIcon || token.icon || token.logo || token.image || token.imageUrl || token.logoUrl || ""
  );
  if (directLogo) return imageProxyUrl(directLogo);

  return "";
}

function tokenLogoMarkup(token = {}, label = "") {
  const initials = String(label || "?").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "?";
  const logoUrl  = String(token.logoUrl || "").trim();
  const color    = tokenColor(label || initials);
  const proxyBase = (localStorage.getItem(STORAGE_KEYS.marketProxyBaseUrl) || "").trim().replace(/\/$/, "");
  const safeLogoUrl = logoUrl.startsWith("./")
    || logoUrl.startsWith("/")
    || logoUrl.startsWith("https://s1.xrplmeta.org/")
    || logoUrl.startsWith("https://wsrv.nl/")
    || logoUrl.startsWith("https://ipfs.io/ipfs/")
    || logoUrl.startsWith("https://cloudflare-ipfs.com/ipfs/")
    || logoUrl.startsWith("https://arweave.net/")
    || (proxyBase && logoUrl.startsWith(`${proxyBase}/image?`))
    ? logoUrl : "";
  if (!safeLogoUrl) {
    return `<span class="token-logo is-fallback" style="--tok-color:${color}"><span>${escapeHtml(initials)}</span></span>`;
  }
  return `<span class="token-logo" style="--tok-color:${color}"><span>${escapeHtml(initials)}</span><img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(label)} logo" loading="lazy" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /></span>`;
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
      const printable = chars.replace(/[^\x20-\x7E]/g, "").trim();
      if (printable && printable.length === chars.length && /[A-Za-z0-9$]/.test(printable)) {
        return printable;
      }
      return `HEX ${value.slice(0, 8)}`;
    } catch {
      return `HEX ${value.slice(0, 8)}`;
    }
  }
  const printable = value.replace(/[^\x20-\x7E]/g, "").trim();
  return printable || "Unknown";
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

function rememberMobileXummPending() {
  if (!isLikelyMobileDevice()) return;
  try {
    sessionStorage.setItem(XUMM_MOBILE_PENDING_KEY, JSON.stringify({
      startedAt: Date.now(),
      network: getWalletState().network || DEFAULT_NETWORK
    }));
  } catch {
    // Optional resume helper only.
  }
}

function clearMobileXummPending() {
  try {
    sessionStorage.removeItem(XUMM_MOBILE_PENDING_KEY);
  } catch {
    // Optional resume helper only.
  }
}

function hasFreshMobileXummPending() {
  try {
    const raw = sessionStorage.getItem(XUMM_MOBILE_PENDING_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw);
    if (!pending?.startedAt || Date.now() - pending.startedAt > XUMM_MOBILE_PENDING_TTL_MS) {
      clearMobileXummPending();
      return false;
    }
    return true;
  } catch {
    clearMobileXummPending();
    return false;
  }
}

function completeXummAppSession(account) {
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
  clearMobileXummPending();
  closeAuthModal();
  renderAll();
  setActivePage("profile");
  setCommandAuthStatus("Signed in with Xumm. Profile and wallet refreshed.");
  setFeedback("Signed in with Xumm. Your portfolio and wallet are loaded.");
}

async function resumeMobileXummReturn() {
  if (state.xummResumeInFlight) return;
  if (!hasFreshMobileXummPending() || hasSigningWallet()) {
    if (hasSigningWallet()) clearMobileXummPending();
    return;
  }

  state.xummResumeInFlight = true;
  setFeedback("Checking returned Xumm/Xaman sign-in...");
  setCommandAuthStatus("Checking returned Xumm/Xaman session...");

  try {
    const xumm = await initXumm(getXamanApiKey());
    const account = await waitForXummAccount(xumm, 8000);
    if (!account) return;
    setCommandAuthStatus("Xumm approved. Loading your XRPL account...");
    const verified = await verifyXummAccount(account);
    if (verified) {
      completeXummAppSession(account);
    }
  } catch (error) {
    if (isExplicitXummRejection(error)) {
      clearMobileXummPending();
      setFeedback(friendlyXummError(error), true);
    }
  } finally {
    state.xummResumeInFlight = false;
  }
}

function pageAccessMessage(page) {
  if (SIGNING_WALLET_PAGES.has(page)) {
    return "DEX access needs a Xumm wallet connection or an XRPL account created in IkeLedger.";
  }
  if (XRPL_ACCOUNT_PAGES.has(page)) {
    return "Connect Xumm, create a wallet, or load an XRPL address before opening that page.";
  }
  if (page === "profile") {
    return "Sign in, connect Xumm, or create an XRPL account before opening Portfolio.";
  }
  if (PROFILE_PAGES.has(page)) {
    return "Sign in to your IkeLedger profile first.";
  }
  return "";
}

function canOpenPage(page) {
  if (SIGNING_WALLET_PAGES.has(page)) return hasSigningWallet();
  if (XRPL_ACCOUNT_PAGES.has(page)) return hasXrplAccount();
  if (PROFILE_PAGES.has(page)) {
    if (page === "profile" && hasXrplAccount()) return true;
    return Boolean(state.appUser);
  }
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
    "xrpl-testnet"
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
    throw new Error("No funded XRPL account was found for this address on Mainnet or Testnet. If this is a new wallet, send XRP to activate it first.");
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

function applyAccent(mode = "aqua") {
  const accent = ["aqua", "gold", "emerald"].includes(mode) ? mode : "aqua";
  document.body.classList.toggle("accent-gold", accent === "gold");
  document.body.classList.toggle("accent-emerald", accent === "emerald");
  localStorage.setItem(STORAGE_KEYS.accent, accent);
  if (refs.accentSelect) refs.accentSelect.value = accent;
}

function cycleTheme() {
  const current = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
  const next = current === "dark" ? "light" : current === "light" ? "system" : "dark";
  applyTheme(next);
}

function clearNftOfferState() {
  state.nftOfferCache.clear();
  state.nftOfferLoading.clear();
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
    // Start live WebSocket price refresh for visible tokens
    if (!state.topIssuedAssets.priceTimer) {
      state.topIssuedAssets.priceTimer = setInterval(() => {
        if (state.activePage === "tokens") void refreshVisibleTokenPrices();
      }, LIVE_TOKEN_PRICE_REFRESH_MS);
    }
  } else {
    // Stop price refresh when navigating away
    if (state.topIssuedAssets.priceTimer) {
      clearInterval(state.topIssuedAssets.priceTimer);
      state.topIssuedAssets.priceTimer = null;
    }
  }

  if (page === "dex") {
    void loadTopIssuedAssets();
    void loadDexOrderBook();
    void loadDexChart();
  }

  if (page === "amm") {
    void loadTopAmmPools();
  }

  if (page === "tracker") {
    renderTrackerPage();
    if (hasXrplAccount() && state.tracker.wallets.length && !state.tracker.running) {
      void startTracker();
    }
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

const _mjCache      = new Map(); // url → { data, ts }
const _mjInFlight   = new Map(); // url → Promise
const _domainTail   = new Map(); // hostname → tail of sequential queue (prevents burst)
const _urlSkipUntil = new Map(); // url → timestamp: skip this exact URL until then (after 429)
const _cgIdCache    = new Map(); // symbol_lower → coingecko_id | null
const MJ_TTL = 120_000;          // 2-minute response cache
const MARKET_FETCH_TIMEOUT_MS = 12_000;

// Serialize requests to each host to prevent concurrent burst firing
function _queuedFetch(url, fn) {
  let host = "";
  try { host = new URL(url).hostname; } catch { }
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
  const skipUntil = _urlSkipUntil.get(url) || 0;
  const requestUrls = [];
  if (Date.now() >= skipUntil) requestUrls.push(url);
  if (proxyBase) {
    requestUrls.push(`${proxyBase}/market?url=${encodeURIComponent(url)}`);
  }
  if (!requestUrls.length) {
    const err = new Error("Market API rate limited (429)");
    err.status = 429;
    throw err;
  }

  const doFetch = async () => {
    let lastError = null;
    for (const requestUrl of requestUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MARKET_FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(requestUrl, {
          signal: controller.signal,
          headers: { accept: "application/json" }
        });
        if (response.status === 429) {
          _urlSkipUntil.set(url, Date.now() + 30_000); // skip this URL for 30s — no blocking wait
          const err = new Error("Market API rate limited (429)");
          err.status = 429;
          lastError = err;
          continue;
        }
        if (!response.ok) {
          const err = new Error(`Market API failed (${response.status})`);
          err.status = response.status;
          lastError = err;
          continue;
        }
        const data = await response.json();
        _mjCache.set(url, { data, ts: Date.now() });
        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Market API request failed");
        if (err.name === "AbortError") err.status = 504;
        lastError = err;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw lastError || new Error("Market API unavailable");
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

// ── Kraken — XRP/USD OHLCV (CORS-friendly, no API key required) ─────
// Used for XRP/USD chart and as the denominator when converting CoinGecko USD→XRP prices.
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

// Look up a token's CoinGecko coin ID by symbol; caches results for the session.
async function fetchCoinGeckoId(symbol) {
  const key = (symbol || "").toLowerCase().trim();
  if (!key) return null;
  if (_cgIdCache.has(key)) return _cgIdCache.get(key);
  try {
    const data = await fetchMarketJson(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(key)}`
    );
    const coins = Array.isArray(data?.coins) ? data.coins : [];
    // Prefer exact symbol match (e.g. "solo" → solo-coin), fall back to first result
    const match = coins.find(c => c.symbol?.toLowerCase() === key) || null;
    const id = match?.id || null;
    _cgIdCache.set(key, id);
    return id;
  } catch {
    _cgIdCache.set(key, null);
    return null;
  }
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

// Account Intelligence

const TRACKER_TX_LABELS = {
  health:   { label: "Health",   color: "var(--xrp-blue)",  icon: "H" },
  security: { label: "Security", color: "var(--danger)",    icon: "!" },
  token:    { label: "Tokens",   color: "var(--turquoise)", icon: "T" },
  nft:      { label: "NFTs",     color: "var(--violet)",    icon: "N" },
  amm:      { label: "AMM / LP", color: "var(--cyan)",      icon: "A" },
  market:   { label: "Market",   color: "var(--mana-gold)", icon: "M" },
  whale:    { label: "Whales",   color: "var(--warn)",      icon: "W" },
  buy:      { label: "Buy",      color: "var(--emerald)",   icon: "+" },
  sell:     { label: "Sell",     color: "var(--danger)",    icon: "-" },
  payment:  { label: "Payment",  color: "var(--turquoise)", icon: "P" },
  offer:    { label: "Offers",   color: "var(--mana-gold)", icon: "O" },
  other:    { label: "Other",    color: "var(--ink-2)",     icon: "." }
};

const SECURITY_TX_TYPES = new Set([
  "AccountDelete", "SetRegularKey", "SignerListSet", "Clawback",
  "DepositPreauth", "AccountSet"
]);
const NFT_TX_TYPES = new Set([
  "NFTokenMint", "NFTokenBurn", "NFTokenCreateOffer",
  "NFTokenAcceptOffer", "NFTokenCancelOffer"
]);
const AMM_TX_TYPES = new Set([
  "AMMCreate", "AMMDeposit", "AMMWithdraw", "AMMVote", "AMMBid", "AMMDelete"
]);

function classifyTrackerTx(txType, tx) {
  if (SECURITY_TX_TYPES.has(txType)) return "security";
  if (NFT_TX_TYPES.has(txType))      return "nft";
  if (AMM_TX_TYPES.has(txType))      return "amm";
  if (txType === "EscrowCreate" || txType === "EscrowFinish" || txType === "EscrowCancel") return "health";
  if (txType === "CheckCreate"  || txType === "CheckCash"    || txType === "CheckCancel")  return "health";
  if (txType === "TrustSet") return "token";
  if (txType === "OfferCreate") {
    return typeof tx.TakerGets === "string" ? "buy" : "sell";
  }
  if (txType === "OfferCancel") return "offer";
  if (txType === "Payment") {
    const amt  = tx.Amount;
    if (typeof amt === "object" && amt?.currency) return "token";
    return "payment";
  }
  return "other";
}

function trackerXrpAmount(tx, meta) {
  // Try DeliveredAmount first (most accurate for payments)
  const delivered = meta?.delivered_amount || meta?.DeliveredAmount;
  if (typeof delivered === "string") return Number(delivered) / 1e6;
  if (typeof tx.Amount === "string") return Number(tx.Amount) / 1e6;
  return 0;
}

function trackerEventSeverity(category, xrpAmount = 0, txType = "") {
  if (category === "security") return "high";
  if (category === "whale" || xrpAmount >= 10000) return "high";
  if (["amm", "token", "nft", "health"].includes(category)) return "medium";
  if (txType === "OfferCancel") return "medium";
  return "low";
}

function trackerEventInsight(category, txType, tx, xrpAmount) {
  if (category === "security") return "Security-sensitive account setting changed. Verify this was intentional.";
  if (category === "whale") return `Large XRP movement detected (${decimalString(xrpAmount, 2)} XRP). Watch for follow-up liquidity or exchange movement.`;
  if (category === "token") {
    const currency = tx.LimitAmount?.currency || tx.Amount?.currency || "issued asset";
    return `Issued asset signal: ${currency}. Review issuer, trust line, and freeze/clawback risk.`;
  }
  if (category === "amm") return "AMM/LP activity can change exposure, pool share, and impermanent loss risk.";
  if (category === "nft") return "NFT ownership or offer activity changed. Review collection, issuer, and offer terms.";
  if (category === "health") return "Account object or reserve-related activity detected. Review available XRP after reserves.";
  if (category === "buy" || category === "sell") return "DEX offer activity detected. It may fill immediately or remain open.";
  if (txType === "Payment") return "Payment movement detected. Confirm destination and source are expected.";
  return "General ledger activity detected for a watched account.";
}

function trackerEventDescription(txType, tx, meta, walletEntry) {
  const addr = tx.Account;
  const lbl  = walletEntry?.label || formatAddress(addr);
  switch (txType) {
    case "Payment":   return `${lbl} sent payment`;
    case "OfferCreate": {
      const gets = tx.TakerGets, pays = tx.TakerPays;
      const getsXrp = typeof gets === "string";
      const currency = getsXrp ? (typeof pays === "object" ? pays.currency : "XRP") : (typeof gets === "object" ? gets.currency : "XRP");
      return `${lbl} placed ${getsXrp ? "buy" : "sell"} order for ${currency}`;
    }
    case "TrustSet":    return `${lbl} set trust line for ${tx.LimitAmount?.currency || "token"}`;
    case "NFTokenMint": return `${lbl} minted NFT`;
    case "AMMDeposit":  return `${lbl} deposited to AMM`;
    case "AMMWithdraw": return `${lbl} withdrew from AMM`;
    case "AccountDelete": return `${lbl} deleted account`;
    case "SetRegularKey": return `${lbl} changed signing key`;
    case "SignerListSet": return `${lbl} updated signer list`;
    case "Clawback":    return `${lbl} clawback issued`;
    case "EscrowCreate": return `${lbl} created escrow`;
    case "EscrowFinish": return `${lbl} finished escrow`;
    case "CheckCreate": return `${lbl} created check`;
    case "CheckCash":   return `${lbl} cashed check`;
    default:            return `${lbl} — ${txType}`;
  }
}

function processTrackerStream(payload) {
  const tx   = payload.transaction || payload.tx_json || {};
  const meta = payload.meta || {};
  if (!tx.Account) return;
  if (meta.TransactionResult && meta.TransactionResult !== "tesSUCCESS") return;

  const txType = tx.TransactionType || "";
  let category = classifyTrackerTx(txType, tx);

  // Find which watched wallet triggered this
  const involvedAddr = [tx.Account, tx.Destination].filter(Boolean);
  const walletEntry = state.tracker.wallets.find(w => involvedAddr.includes(w.address));
  if (!walletEntry && state.tracker.wallets.length > 0) return; // not from a watched wallet

  const xrpAmt = trackerXrpAmount(tx, meta);
  if (txType === "Payment" && xrpAmt >= 10000) {
    category = "whale";
  }
  const severity = trackerEventSeverity(category, xrpAmt, txType);

  const event = {
    id:          tx.hash || String(Date.now()),
    type:        category,
    account:     tx.Account,
    label:       walletEntry?.label || "",
    group:       walletEntry?.group || "",
    xrpAmount:   xrpAmt,
    description: trackerEventDescription(txType, tx, meta, walletEntry),
    intelligence: trackerEventInsight(category, txType, tx, xrpAmt),
    severity,
    txType,
    isAlert:     severity === "high",
    timestamp:   Date.now(),
    txHash:      tx.hash || ""
  };

  // Check min-XRP filter
  if (state.tracker.minXrp > 0 && xrpAmt < state.tracker.minXrp && category !== "security") return;

  state.tracker.feed.unshift(event);
  if (state.tracker.feed.length > state.tracker.feedLimit) {
    state.tracker.feed.pop();
  }

  if (state.activePage === "tracker") {
    renderTrackerFeed();
    refreshAccountIntelligenceOverview();
  }
}

let _trackerStreamHandler = null;

async function startTracker() {
  if (state.tracker.running) return;
  if (!state.tracker.wallets.length) return;

  const walletState = getWalletState();
  const networkKey  = walletState.network || DEFAULT_NETWORK;
  const addresses = state.tracker.wallets.map(w => w.address).filter(Boolean);
  if (!addresses.length) return;

  try {
    await ensureXrplConnection(networkKey);
    if (_trackerStreamHandler) {
      removeXrplStreamHandler(networkKey, _trackerStreamHandler);
    }
    _trackerStreamHandler = processTrackerStream;
    addXrplStreamHandler(networkKey, _trackerStreamHandler);
    await requestXrplCommand(networkKey, { command: "subscribe", accounts: addresses });
    state.tracker.running = true;
  } catch (error) {
    if (_trackerStreamHandler) {
      removeXrplStreamHandler(networkKey, _trackerStreamHandler);
      _trackerStreamHandler = null;
    }
    state.tracker.running = false;
    setFeedback(error instanceof Error ? `Account Intelligence stream unavailable: ${error.message}` : "Account Intelligence stream unavailable.", true);
  } finally {
    renderTrackerPage();
  }
}

function stopTracker() {
  if (!state.tracker.running) return;
  const walletState = getWalletState();
  const networkKey  = walletState.network || DEFAULT_NETWORK;
  if (_trackerStreamHandler) {
    removeXrplStreamHandler(networkKey, _trackerStreamHandler);
    _trackerStreamHandler = null;
  }
  const addresses = state.tracker.wallets.map(w => w.address).filter(Boolean);
  if (addresses.length) {
    void requestXrplCommand(networkKey, { command: "unsubscribe", accounts: addresses }).catch(() => {});
  }
  state.tracker.running = false;
}

function saveTrackerWallets() {
  try { localStorage.setItem("ike_tracker_wallets_v1", JSON.stringify(state.tracker.wallets)); } catch { }
}
function loadTrackerWallets() {
  try {
    const raw = JSON.parse(localStorage.getItem("ike_tracker_wallets_v1") || "[]");
    if (Array.isArray(raw)) state.tracker.wallets = raw;
  } catch { }
}

function ensureConnectedWalletTracked(walletState = getWalletState()) {
  const address = walletState.publicAddress || "";
  if (!XRPL_ADDRESS_PATTERN.test(address)) return false;
  if (state.tracker.wallets.some((wallet) => wallet.address === address)) return false;

  state.tracker.wallets.unshift({
    address,
    label: walletState.provider === "xaman" ? "Xaman Wallet" : "Connected Wallet",
    group: "My Wallet"
  });
  saveTrackerWallets();
  return true;
}

function intelligencePosture(score) {
  if (score >= 85) {
    return { label: "Strong", tone: "safe", detail: "Healthy reserve posture with no urgent account warnings." };
  }
  if (score >= 70) {
    return { label: "Stable", tone: "low", detail: "Normal activity. Keep watching reserves, trust lines, and signing changes." };
  }
  if (score >= 50) {
    return { label: "Review", tone: "medium", detail: "Some account conditions deserve attention before adding risk." };
  }
  return { label: "Critical", tone: "danger", detail: "High-priority account signals detected. Review before signing anything new." };
}

function getAccountIntelligence(walletState = getWalletState()) {
  const snapshot = walletState?.snapshot || null;
  const account = snapshot?.account || {};
  const tokenHoldings = snapshot?.tokenHoldings || [];
  const issuedTokens = snapshot?.issuedTokenEntries || [];
  const nfts = snapshot?.nftItems || [];
  const amm = snapshot?.amm || {};
  const feed = state.tracker.feed || [];
  const securityEvents = getSecurityEvents();

  const balance = toFiniteNumber(account.balanceXrp, Number.NaN);
  const available = toFiniteNumber(account.availableXrp, Number.NaN);
  const reserve = toFiniteNumber(account.ownerReserveXrp, Number.NaN);
  const ownerCount = toFiniteNumber(account.ownerCount, 0);
  const trustLines = toFiniteNumber(account.trustLines ?? tokenHoldings.length, 0);
  const nftCount = toFiniteNumber(account.nftCount ?? nfts.length, 0);
  const ammCount = toFiniteNumber(amm.objectCount, 0);
  const ammActivity = toFiniteNumber(amm.recentActivityCount, 0);
  const txCount = toFiniteNumber(account.recentActivityCount ?? snapshot?.txItems?.length, 0);
  const nftOffers = nfts.reduce((sum, nft) => sum + nftOfferCount(nft), 0);
  const totalAccountXrp = Number.isFinite(balance) ? balance : 0;
  const reserveRatio = Number.isFinite(reserve) && totalAccountXrp > 0 ? (reserve / totalAccountXrp) * 100 : 0;
  const highFeedAlerts = feed.filter((ev) => ev.severity === "high").length;
  const mediumFeedAlerts = feed.filter((ev) => ev.severity === "medium").length;
  const whaleEvents = feed.filter((ev) => ev.type === "whale").length;
  const dexEvents = feed.filter((ev) => ev.type === "buy" || ev.type === "sell" || ev.type === "offer").length;
  const tokenEvents = feed.filter((ev) => ev.type === "token").length;
  const nftEvents = feed.filter((ev) => ev.type === "nft").length;
  const ammEvents = feed.filter((ev) => ev.type === "amm").length;
  const sensitiveEvents = securityEvents.filter((event) =>
    [RISK_LEVELS.BLOCKED, RISK_LEVELS.HIGH, RISK_LEVELS.MEDIUM].includes(event.riskLevel)
  ).length;

  let score = snapshot ? 100 : 58;
  const alerts = [];

  if (!walletState?.publicAddress) {
    score = 40;
    alerts.push({ tone: "danger", label: "No account connected", detail: "Connect or create an XRPL account to unlock account intelligence." });
  } else if (!snapshot) {
    alerts.push({ tone: "medium", label: "Snapshot pending", detail: "Wallet address is loaded, but live account details have not been verified yet." });
  }

  if (snapshot) {
    if (Number.isFinite(available) && available < 1) {
      score -= 25;
      alerts.push({ tone: "danger", label: "Low spendable XRP", detail: "Available XRP is below 1 XRP after reserves. Transactions may fail." });
    } else if (Number.isFinite(available) && available < 5) {
      score -= 10;
      alerts.push({ tone: "medium", label: "Tight spendable balance", detail: "Available XRP is low. Keep reserve and fee requirements in mind." });
    }

    if (reserveRatio > 60) {
      score -= 12;
      alerts.push({ tone: "medium", label: "Reserve pressure", detail: `${formatUnsignedPercent(reserveRatio)} of total XRP is reserved by owned objects.` });
    } else if (reserveRatio > 40) {
      score -= 6;
      alerts.push({ tone: "low", label: "Reserve watch", detail: "A large share of XRP is tied to trust lines, offers, NFTs, or other ledger objects." });
    }

    if (trustLines > 50) {
      score -= 12;
      alerts.push({ tone: "medium", label: "Large trust-line surface", detail: `${trustLines} trust lines found. Review issuer quality and unwanted lines.` });
    } else if (trustLines > 25) {
      score -= 7;
      alerts.push({ tone: "low", label: "Trust-line review", detail: "Trust-line count is growing. Remove stale or risky issuers when possible." });
    }
  }

  if (sensitiveEvents > 0) {
    score -= Math.min(24, sensitiveEvents * 8);
    alerts.push({ tone: "danger", label: "Security events detected", detail: `${sensitiveEvents} medium-or-higher local security event${sensitiveEvents === 1 ? "" : "s"} recorded this session.` });
  }

  if (highFeedAlerts > 0) {
    score -= Math.min(18, highFeedAlerts * 6);
    alerts.push({ tone: "danger", label: "High-priority ledger signal", detail: `${highFeedAlerts} high-severity event${highFeedAlerts === 1 ? "" : "s"} in the live intelligence feed.` });
  }

  if (whaleEvents > 0) {
    score -= Math.min(10, whaleEvents * 3);
    alerts.push({ tone: "medium", label: "Whale flow nearby", detail: "Large XRP movement appeared in the watched-account stream." });
  }

  if (!alerts.length) {
    alerts.push({ tone: "safe", label: "No urgent warnings", detail: "No high-priority account intelligence alerts are active right now." });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const posture = intelligencePosture(score);

  return {
    score,
    posture,
    connected: Boolean(walletState?.publicAddress),
    snapshotReady: Boolean(snapshot),
    watchedAccounts: state.tracker.wallets.length,
    alerts: alerts.slice(0, 5),
    cards: [
      {
        label: "Wallet Health",
        value: Number.isFinite(available) ? `${formatCompactNumber(available, 2)} XRP` : "Pending",
        detail: Number.isFinite(balance)
          ? `${formatCompactNumber(balance, 2)} XRP total, ${formatCompactNumber(reserve, 2)} XRP reserved`
          : "Connect and sync account reserves",
        tone: Number.isFinite(available) && available < 1 ? "danger" : Number.isFinite(available) && available < 5 ? "medium" : "safe"
      },
      {
        label: "Security Posture",
        value: sensitiveEvents || highFeedAlerts ? `${sensitiveEvents + highFeedAlerts} alerts` : "Clear",
        detail: `${securityEvents.length} local events, ${highFeedAlerts} high-priority ledger signals`,
        tone: sensitiveEvents || highFeedAlerts ? "danger" : "safe"
      },
      {
        label: "Asset Exposure",
        value: `${tokenHoldings.length} tokens`,
        detail: `${trustLines} trust lines, ${issuedTokens.length} issued projects`,
        tone: trustLines > 50 ? "medium" : "low"
      },
      {
        label: "NFT / AMM Watch",
        value: `${nftCount} NFTs`,
        detail: `${nftOffers} NFT offers, ${ammCount} AMM positions, ${ammActivity} recent AMM actions`,
        tone: nftOffers || ammCount ? "medium" : "low"
      },
      {
        label: "Market Signals",
        value: `${whaleEvents + dexEvents} events`,
        detail: `${whaleEvents} whale, ${dexEvents} DEX, ${tokenEvents} token, ${nftEvents} NFT, ${ammEvents} AMM`,
        tone: whaleEvents ? "medium" : dexEvents || tokenEvents || ammEvents ? "low" : "safe"
      },
      {
        label: "Ledger Activity",
        value: `${txCount} recent`,
        detail: `${ownerCount} owned ledger objects, ${mediumFeedAlerts} medium live signals`,
        tone: mediumFeedAlerts ? "medium" : "low"
      }
    ]
  };
}

function intelligenceMetricCard(label, value, detail, tone = "low") {
  return `
    <article class="intelligence-card tone-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderAccountIntelligenceOverviewBody(walletState = getWalletState(), running = state.tracker.running) {
  const model = getAccountIntelligence(walletState);
  return `
    <div class="intelligence-overview-grid">
      <article class="intelligence-score-card tone-${escapeHtml(model.posture.tone)}">
        <div>
          <span class="intelligence-kicker">Account Health</span>
          <strong class="intelligence-score-value">${model.score}</strong>
          <em>${escapeHtml(model.posture.label)}</em>
        </div>
        <p>${escapeHtml(model.posture.detail)}</p>
        <div class="intelligence-score-meta">
          <span>${running ? "Streaming live" : "Stream paused"}</span>
          <span>${model.snapshotReady ? "Snapshot verified" : "Snapshot pending"}</span>
          <span>${model.watchedAccounts} watched</span>
        </div>
      </article>
      <div class="intelligence-metric-grid">
        ${model.cards.map((card) => intelligenceMetricCard(card.label, card.value, card.detail, card.tone)).join("")}
      </div>
    </div>
    <div class="intelligence-alert-list">
      ${model.alerts.map((alert) => `
        <div class="intelligence-alert tone-${escapeHtml(alert.tone)}">
          <strong>${escapeHtml(alert.label)}</strong>
          <span>${escapeHtml(alert.detail)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAccountIntelligenceOverview(walletState = getWalletState(), running = state.tracker.running) {
  return `<div id="accountIntelligenceOverview" class="account-intelligence-overview">${renderAccountIntelligenceOverviewBody(walletState, running)}</div>`;
}

function refreshAccountIntelligenceOverview() {
  const el = document.getElementById("accountIntelligenceOverview");
  if (el) {
    el.innerHTML = renderAccountIntelligenceOverviewBody(getWalletState(), state.tracker.running);
  }
}

function renderTrackerFeed() {
  const feedEl = document.getElementById("trackerFeedList");
  if (!feedEl) return;
  const { feed, txFilters, minXrp, groupFilter } = state.tracker;
  const filtered = feed.filter(ev => {
    if (!txFilters.has(ev.type)) return false;
    if (minXrp > 0 && ev.xrpAmount < minXrp && !ev.isAlert) return false;
    if (groupFilter && ev.group !== groupFilter) return false;
    return true;
  });
  if (!filtered.length) {
    feedEl.innerHTML = `<div class="tracker-feed-empty"><span>No intelligence events yet</span><p>Watching ${state.tracker.wallets.length} account${state.tracker.wallets.length !== 1 ? "s" : ""}. Health, security, market, AMM, NFT, and DEX signals will stream here in real time.</p></div>`;
    return;
  }
  feedEl.innerHTML = filtered.slice(0, 80).map(ev => {
    const meta = TRACKER_TX_LABELS[ev.type] || TRACKER_TX_LABELS.other;
    const timeStr = new Date(ev.timestamp).toLocaleTimeString();
    const xrpStr = ev.xrpAmount > 0 ? `<span class="tfe-xrp">${ev.xrpAmount.toFixed(2)} XRP</span>` : "";
    const hashUrl = ev.txHash ? `https://xrpl.to/tx/${ev.txHash}` : "";
    const severity = ["high", "medium", "low"].includes(ev.severity) ? ev.severity : "low";
    const severityLabel = severity === "high" ? "High" : severity === "medium" ? "Review" : "Info";
    return `
      <div class="tracker-feed-event severity-${severity}${ev.isAlert ? " is-alert" : ""}">
        <div class="tfe-icon" style="color:${meta.color}">${meta.icon}</div>
        <div class="tfe-body">
          <div class="tfe-top">
            <span class="tfe-type" style="color:${meta.color}">${meta.label}</span>
            <span class="tfe-severity">${severityLabel}</span>
            <span class="tfe-label">${escapeHtml(ev.label || formatAddress(ev.account))}</span>
            ${ev.group ? `<span class="tfe-group">${escapeHtml(ev.group)}</span>` : ""}
            ${xrpStr}
            <span class="tfe-time">${timeStr}</span>
          </div>
          <div class="tfe-desc">${escapeHtml(ev.description)}</div>
          <div class="tfe-intel">${escapeHtml(ev.intelligence || "Review this event before acting on related market movement.")}</div>
          ${hashUrl ? `<a class="tfe-hash" href="${hashUrl}" target="_blank" rel="noopener noreferrer">${ev.txHash.slice(0, 16)}…</a>` : ""}
        </div>
      </div>`;
  }).join("");
}

function renderTrackerPage() {
  if (!refs.trackerPage) return;
  const walletState = getWalletState();
  const connected   = Boolean(walletState?.publicAddress);
  if (connected) {
    ensureConnectedWalletTracked(walletState);
  }
  const { wallets, running, txFilters, minXrp, groupFilter } = state.tracker;

  if (!connected) {
    refs.trackerPage.innerHTML = `
      <div class="tracker-landing">
        <div class="tracker-hero-card glass-card">
          <div class="tracker-hero-text">
            <div class="mode-pill">Account Intelligence</div>
            <h3>IkeLedger Account Intelligence</h3>
            <p>Connect or create an XRPL account to monitor wallet health, reserve pressure, security posture, token exposure, AMM/NFT signals, whale movement, and DEX activity.</p>
            <div class="tracker-free-tier">
              <span class="chip chip-cyan">50 watched accounts</span>
              <span class="chip chip-cyan">Live XRPL stream</span>
              <span class="chip chip-cyan">Risk alerts</span>
            </div>
            <p class="muted">Wallet-only intelligence unlocks after Xaman sign-in or an IkeLedger-created XRPL account.</p>
          </div>
          <div class="tracker-features-grid">
            ${[
              ["H","Wallet Health","Spendable XRP, reserve pressure, owned-object load, and account readiness."],
              ["S","Security Signals","AccountDelete, SetRegularKey, SignerListSet, Clawback, and blocked secret input warnings."],
              ["A","Asset Exposure","Trust lines, issued assets, token movement, and concentration review prompts."],
              ["N","NFT / AMM Watch","NFT offers, AMM positions, LP movement, and liquidity-risk signals."],
              ["M","Market Movement","Whale payments, DEX offers, and token activity flowing through watched accounts."],
              ["R","Risk Guidance","Plain-language notes on what to verify before signing or following a trade."],
            ].map(([icon, title, desc]) => `
              <div class="tracker-feature-item">
                <div class="tfi-icon">${icon}</div>
                <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(desc)}</p></div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="tracker-tier-row">
          ${[
            ["Health","Reserve pressure","Spendable XRP, owned objects, trust lines, and readiness checks.","chip-cyan"],
            ["Security","Signing posture","Sensitive account changes and local safety events stay visible.","chip-gold"],
            ["Markets","Manipulation watch","Whale flows, DEX orders, token moves, and AMM activity are grouped.","chip-violet"],
            ["Profile","Wallet gating","Profile-only users can browse; wallet users unlock transaction tools.","chip-diamond"],
          ].map(([name, price, perks, chipClass]) => `
            <div class="tracker-tier-card glass-card">
              <span class="chip ${chipClass}">${escapeHtml(name)}</span>
              <strong class="tier-price">${escapeHtml(price)}</strong>
              <p>${escapeHtml(perks)}</p>
            </div>
          `).join("")}
        </div>
      </div>`;
    return;
  }

  const allGroups = [...new Set(wallets.map(w => w.group).filter(Boolean))];
  const filterChips = Object.entries(TRACKER_TX_LABELS).map(([key, meta]) => {
    const active = txFilters.has(key);
    return `<button class="trk-filter-chip${active ? " active" : ""}" data-filter="${key}" type="button" style="${active ? `--chip-color:${meta.color}` : ""}">${meta.icon} ${meta.label}</button>`;
  }).join("");
  const accountIntelligenceHtml = renderAccountIntelligenceOverview(walletState, running);

  refs.trackerPage.innerHTML = `
    <div class="tracker-active-layout">

      <!-- Left panel: wallets + groups -->
      <aside class="tracker-sidebar glass-card">
        <div class="section-top">
          <h3>Watched Accounts</h3>
          <button class="trk-start-btn${running ? " is-running" : ""}" id="trackerToggleBtn" type="button">
            ${running ? "Stop" : "Start"}
          </button>
        </div>
        <div class="tracker-status-chip">
          ${running
            ? `<span class="chip chip-live">Live</span> intelligence stream for ${wallets.length} account${wallets.length !== 1 ? "s" : ""}`
            : `<span class="chip">Paused</span> ${wallets.length} account${wallets.length !== 1 ? "s" : ""} ready`}
        </div>

        <!-- Add account form -->
        <form class="tracker-add-form" id="trackerAddForm">
          <input class="trk-input" id="trackerAddressInput" type="text" placeholder="rXRPL address…" autocomplete="off" maxlength="35" />
          <input class="trk-input" id="trackerLabelInput"   type="text" placeholder="Label (optional)" autocomplete="off" maxlength="32" />
          <div class="trk-row">
            <input class="trk-input" id="trackerGroupInput" type="text" placeholder="Group (optional)" autocomplete="off" maxlength="24" list="trackerGroupList" />
            <datalist id="trackerGroupList">${allGroups.map(g => `<option value="${escapeHtml(g)}">`).join("")}</datalist>
            <button class="ghost" type="submit">Add</button>
          </div>
        </form>

        <!-- Account list -->
        <div class="tracker-wallet-list" id="trackerWalletList">
          ${wallets.length ? wallets.map((w, i) => `
            <div class="tracker-wallet-item">
              <div class="twi-info">
                <strong>${escapeHtml(w.label || formatAddress(w.address))}</strong>
                <span>${escapeHtml(formatAddress(w.address))}</span>
                ${w.group ? `<span class="tfe-group">${escapeHtml(w.group)}</span>` : ""}
              </div>
              <button class="ghost trk-remove-btn" data-wallet-index="${i}" type="button" title="Remove">✕</button>
            </div>
          `).join("") : `<p class="muted" style="padding:0.6rem">Add accounts above to start intelligence monitoring.</p>`}
        </div>

        <!-- Group filter -->
        ${allGroups.length ? `
        <div class="tracker-group-filter">
          <span>Filter group:</span>
          <div class="tracker-group-chips">
            <button class="tag-chip${!groupFilter ? " active" : ""}" data-group="" type="button">All</button>
            ${allGroups.map(g => `<button class="tag-chip${groupFilter === g ? " active" : ""}" data-group="${escapeHtml(g)}" type="button">${escapeHtml(g)}</button>`).join("")}
          </div>
        </div>` : ""}

        <!-- External signal stub -->
        <div class="tracker-social-stub">
          <div class="section-top" style="margin-top:0.9rem">
            <h4>Project / Market Watch</h4>
            <span class="chip chip-cyan">Beta</span>
          </div>
          <p class="muted" style="font-size:0.78rem">Issuer reputation, project announcements, and market-context signals can be layered here next.</p>
          <input class="trk-input" type="text" placeholder="Issuer or project watch (coming soon)" disabled />
        </div>
      </aside>

      <!-- Right panel: feed + filters -->
      <div class="tracker-feed-panel">
        ${accountIntelligenceHtml}

        <!-- Filter chips -->
        <div class="tracker-filter-row">
          <div class="tracker-filter-chips">${filterChips}</div>
          <div class="tracker-min-xrp">
            <label>
              <span>Min XRP</span>
              <input id="trackerMinXrp" class="trk-input" type="number" min="0" step="1" value="${minXrp}" placeholder="0" style="width:70px" />
            </label>
          </div>
        </div>

        <!-- Live feed -->
        <div class="tracker-feed-wrap glass-card">
          <div class="section-top">
            <h3>Intelligence Feed</h3>
            <div style="display:flex;gap:0.5rem;align-items:center">
              ${running ? `<span class="chip chip-live">Streaming</span>` : `<span class="chip">Paused</span>`}
              <button class="ghost" id="trackerClearFeedBtn" type="button">Clear</button>
            </div>
          </div>
          <div class="tracker-feed-list" id="trackerFeedList"></div>
        </div>
      </div>
    </div>`;

  renderTrackerFeed();

  // Wire up events
  document.getElementById("trackerToggleBtn")?.addEventListener("click", () => {
    if (state.tracker.running) { stopTracker(); renderTrackerPage(); }
    else { void startTracker(); }
  });

  document.getElementById("trackerAddForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const addr  = document.getElementById("trackerAddressInput")?.value.trim();
    const label = document.getElementById("trackerLabelInput")?.value.trim() || "";
    const group = document.getElementById("trackerGroupInput")?.value.trim() || "";
    if (!XRPL_ADDRESS_PATTERN.test(addr)) return;
    if (state.tracker.wallets.some(w => w.address === addr)) return;
    if (state.tracker.wallets.length >= 50) return;
    state.tracker.wallets.push({ address: addr, label, group });
    saveTrackerWallets();
    if (state.tracker.running) { stopTracker(); void startTracker(); }
    renderTrackerPage();
  });

  document.querySelectorAll(".trk-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.walletIndex);
      state.tracker.wallets.splice(idx, 1);
      saveTrackerWallets();
      if (state.tracker.running) { stopTracker(); if (state.tracker.wallets.length) void startTracker(); }
      renderTrackerPage();
    });
  });

  document.querySelectorAll(".trk-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.filter;
      if (state.tracker.txFilters.has(key)) state.tracker.txFilters.delete(key);
      else state.tracker.txFilters.add(key);
      renderTrackerPage();
    });
  });

  document.getElementById("trackerMinXrp")?.addEventListener("change", (e) => {
    state.tracker.minXrp = Math.max(0, Number(e.target.value) || 0);
    renderTrackerFeed();
  });

  document.getElementById("trackerClearFeedBtn")?.addEventListener("click", () => {
    state.tracker.feed = [];
    renderTrackerFeed();
    refreshAccountIntelligenceOverview();
  });

  document.querySelectorAll("[data-group]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tracker.groupFilter = btn.dataset.group || "";
      renderTrackerPage();
    });
  });
}

async function renderMarketOverview(forceRefresh = false, options = {}) {
  try {
    const cacheKey = state.chartTimeframe;
    const shouldUseCache = !forceRefresh
      && state.marketCache.key === cacheKey
      && Date.now() - state.marketCache.fetchedAt < MARKET_LIVE_CACHE_MS
      && state.marketCache.snapshot;

    let snapshot = state.marketCache.snapshot;
    if (!shouldUseCache) {
      const chartCacheReady = state.marketCache.chartKey === cacheKey
        && Array.isArray(state.marketCache.points)
        && state.marketCache.points.length
        && Date.now() - state.marketCache.chartFetchedAt < MARKET_CHART_CACHE_MS;
      const chartPromise = chartCacheReady && !options.forceChart
        ? Promise.resolve(state.marketCache.points)
        : fetchXrpChartPoints(state.chartTimeframe).catch(() => state.marketCache.points || []);

      const [overview, points, networkMetrics] = await Promise.all([
        fetchXrpOverview(),
        chartPromise,
        fetchXrplNetworkMetrics()
          .then((metrics) => ({ ...metrics, sourceOk: true }))
          .catch(() => ({ ledgerIndex: 0, tps: "n/a", feeDrops: "n/a", sourceOk: false }))
      ]);
      const fetchedAt = Date.now();
      const nextPoints = Array.isArray(points) && points.length ? points : (state.marketCache.points || []);
      const chartFetchedAt = nextPoints === state.marketCache.points
        ? state.marketCache.chartFetchedAt
        : fetchedAt;

      snapshot = {
        ...overview,
        ...networkMetrics,
        points: nextPoints,
        fetchedAt,
        sources: {
          coingecko: chartCacheReady && !options.forceChart ? "Cached" : "XRPL DEX",
          xrpl: networkMetrics.sourceOk ? "Live" : "Degraded",
          xrplTo: state.topIssuedAssets.items.length || state.topAmmPools.items.length ? "Cached" : "On demand"
        }
      };
      state.marketCache = {
        key: cacheKey,
        fetchedAt,
        snapshot,
        chartKey: cacheKey,
        chartFetchedAt,
        points: nextPoints
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

function getPortfolioStyle() {
  return {
    mood: localStorage.getItem(STORAGE_KEYS.portfolioMood) || "aqua",
    density: localStorage.getItem(STORAGE_KEYS.portfolioDensity) || "showcase",
    glow: Number.parseInt(localStorage.getItem(STORAGE_KEYS.portfolioGlow) || "65", 10)
  };
}

function syncPortfolioStyleControls(style = getPortfolioStyle()) {
  if (refs.portfolioMoodInput) refs.portfolioMoodInput.value = style.mood;
  if (refs.portfolioDensityInput) refs.portfolioDensityInput.value = style.density;
  if (refs.portfolioGlowInput) refs.portfolioGlowInput.value = String(style.glow);
}

function applyPortfolioStyle() {
  const style = getPortfolioStyle();
  const section = document.querySelector('.page-section[data-page="profile"]');
  const glow = Math.max(0, Math.min(100, Number.isFinite(style.glow) ? style.glow : 65));
  if (section) {
    section.dataset.portfolioMood = style.mood;
    section.dataset.portfolioDensity = style.density;
    section.style.setProperty("--portfolio-glow-size", `${Math.round(12 + glow * 0.38)}px`);
    section.style.setProperty("--portfolio-glow-alpha", (0.08 + glow * 0.0024).toFixed(3));
  }
  syncPortfolioStyleControls({ ...style, glow });
}

function savePortfolioStyle() {
  localStorage.setItem(STORAGE_KEYS.portfolioMood, refs.portfolioMoodInput?.value || "aqua");
  localStorage.setItem(STORAGE_KEYS.portfolioDensity, refs.portfolioDensityInput?.value || "showcase");
  localStorage.setItem(STORAGE_KEYS.portfolioGlow, refs.portfolioGlowInput?.value || "65");
  applyPortfolioStyle();
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
  applyPortfolioStyle();
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
  const providerKey = walletState.provider || sessionStorage.getItem("ike_wallet_provider") || "read-only";
  const providerLabel = providerKey === "xaman" ? "Xaman signer"
    : providerKey === "created" ? "IkeLedger-created wallet"
      : "Read-only account";
  const signingLabel = providerKey === "xaman" ? "Transactions sign in Xaman"
    : providerKey === "created" ? "Created wallet loaded - connect in Xaman to sign"
      : "Read-only exploration";
  const holdings = snapshot?.tokenHoldings || [];
  const nfts = snapshot?.nftItems || [];
  const amm = snapshot?.amm || {};
  const txItems = snapshot?.txItems || [];
  const profile = walletState.profile || getProfileFields();
  const photo = localStorage.getItem(STORAGE_KEYS.profilePhoto);
  const avatarMarkup = photo
    ? `<span class="portfolio-profile-avatar has-photo"><img src="${escapeHtml(photo)}" alt="${escapeHtml(profile.displayName)} profile photo" /></span>`
    : `<span class="portfolio-profile-avatar">${escapeHtml(profile.initials)}</span>`;

  // Reserve breakdown — live from XRPL or fallback to current spec values
  const ownerCount = account?.ownerCount ?? 0;
  const baseReserveXrp = 1;
  const ownerReservePerObj = 0.2;
  const totalOwnerReserve = (ownerCount * ownerReservePerObj).toFixed(2);
  const totalReserved = (baseReserveXrp + ownerCount * ownerReservePerObj).toFixed(2);

  const statusColor = !isVerified ? "var(--warn)" : "var(--emerald)";
  const statusLabel = !isVerified ? "Address loaded — not yet verified on-chain" : account?.accountStatus || "Active";
  const assetPreviewItems = [
    {
      label: "XRP",
      detail: "Native asset",
      value: `${safeNumber(account?.balanceXrp || 0, 4)} XRP`,
      tone: "native"
    },
    ...holdings.slice(0, 5).map((token) => ({
      label: decodeCurrencyCode(token.currency),
      detail: `Issuer ${formatAddress(token.counterparty)}`,
      value: `${safeNumber(token.balance, 4)} ${decodeCurrencyCode(token.currency)}`,
      tone: "issued"
    }))
  ];
  const recentActivityHtml = txItems.length
    ? txItems.slice(0, 4).map((tx) => `
        <div class="portfolio-activity-item">
          <strong>${escapeHtml(tx.label || tx.type || "Ledger event")}</strong>
          <span>${escapeHtml(tx.amount || "-")} ${escapeHtml(tx.asset || "")} - ${escapeHtml(formatLedgerDate(tx.date))}</span>
        </div>
      `).join("")
    : `<p class="muted">No recent ledger activity loaded yet.</p>`;
  const assetPreviewHtml = assetPreviewItems.length
    ? assetPreviewItems.map((asset) => `
        <div class="portfolio-asset-pill ${asset.tone}">
          <strong>${escapeHtml(asset.label)}</strong>
          <span>${escapeHtml(asset.value)}</span>
          <em>${escapeHtml(asset.detail)}</em>
        </div>
      `).join("")
    : `<p class="muted">No assets loaded yet.</p>`;

  refs.profileWalletPanel.innerHTML = `
    <div class="portfolio-showcase-hero">
      <div class="portfolio-profile-block">
        ${avatarMarkup}
        <div class="portfolio-hero-copy">
          <span class="mode-pill">${escapeHtml(providerLabel)}</span>
          <h3>${escapeHtml(profile.displayName)}</h3>
          <div class="portfolio-hero-meta">
            <span>${escapeHtml(profile.handle)}</span>
            <span>${escapeHtml(profile.realm)}</span>
            <span>${isVerified ? "Wallet Portfolio Loaded" : "Wallet Address Loaded"}</span>
          </div>
          <p>${escapeHtml(profile.bio)}</p>
          <p class="muted">${escapeHtml(signingLabel)}. Balances, exposure, owned objects, and transaction readiness stay connected to this XRPL account.</p>
        </div>
      </div>
      <div class="portfolio-connection-actions">
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="wallet">Wallet Status</button>
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="tokens">Tokens</button>
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="nfts">NFTs</button>
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="amm">AMM / LP</button>
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="dex">DEX</button>
      </div>
    </div>

    <div class="profile-wallet-address-row portfolio-address-row">
      <span class="profile-wallet-addr-label">Classic Address</span>
      <code class="profile-wallet-addr">${escapeHtml(publicAddress)}</code>
      <button type="button" class="ghost keygen-copy-btn profile-wallet-copy" data-copy="${escapeHtml(publicAddress)}">Copy</button>
    </div>

    <div class="profile-wallet-status-row">
      <span class="profile-wallet-status-dot" style="background:${statusColor}"></span>
      <span style="color:${statusColor}; font-size:0.82rem; font-weight:600;">${statusLabel}</span>
      <span class="muted" style="font-size:0.78rem;">- ${escapeHtml(mode || "Read-only Mode")}</span>
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
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">Issued Assets</span>
        <span class="profile-wallet-kpi-value cyan">${holdings.length}</span>
        <span class="profile-wallet-kpi-unit">balances</span>
      </div>
      <div class="profile-wallet-kpi">
        <span class="profile-wallet-kpi-label">AMM / LP</span>
        <span class="profile-wallet-kpi-value turquoise">${amm.objectCount ?? 0}</span>
        <span class="profile-wallet-kpi-unit">positions</span>
      </div>
    </div>

    <div class="portfolio-preview-grid">
      <div class="portfolio-preview-panel">
        <div class="section-top compact">
          <h4>Asset Exposure</h4>
          <span class="mode-pill">${holdings.length + 1} shown</span>
        </div>
        <div class="portfolio-asset-strip">${assetPreviewHtml}</div>
      </div>
      <div class="portfolio-preview-panel">
        <div class="section-top compact">
          <h4>Recent Activity</h4>
          <span class="mode-pill">${txItems.length} loaded</span>
        </div>
        <div class="portfolio-activity-list">${recentActivityHtml}</div>
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
      <div class="button-row">
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="dashboard">Refresh Account</button>
        <button type="button" class="ghost profile-wallet-nav-btn" data-nav="create-wallet">Create Wallet</button>
      </div>
      ${netConfig.isMainnet ? `<p class="keygen-danger-note">Mainnet selected - real assets may be involved.</p>` : ""}
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

  refs.profileWalletPanel.querySelectorAll(".profile-wallet-nav-btn[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => setActivePage(btn.dataset.nav || "dashboard"));
  });
}

function onSaveProfile() {
  const nextProfile = getProfileEditorValues();
  updateProfileState(nextProfile);
  savePortfolioStyle();
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
    priceXrp: toFiniteNumber(token.exch ?? token.xrp ?? token.priceXrp, Number.NaN),
    priceUsd: toFiniteNumber(token.usd ?? token.priceUsd, Number.NaN),
    change5m:  toFiniteNumber(token.pro5m  ?? token.p5m,  Number.NaN),
    change1h:  toFiniteNumber(token.pro1h  ?? token.p1h,  Number.NaN),
    change24h: toFiniteNumber(token.pro24h ?? token.p24h, Number.NaN),
    change7d:  toFiniteNumber(token.pro7d  ?? token.p7d,  Number.NaN),
    marketCap: toFiniteNumber(token.marketcap, Number.NaN),
    holders: toFiniteNumber(token.holders, Number.NaN),
    trustlines: toFiniteNumber(token.trustlines, Number.NaN),
    volume24h: toFiniteNumber(token.vol24hxrp ?? token.vol24hx ?? token.vol24h, Number.NaN),
    tradeCount: toFiniteNumber(token.vol24htx ?? token.vol24hTx ?? token.trades24h, Number.NaN),
    uniqueTraders: toFiniteNumber(token.uniqueTraders ?? token.uniqueTraders24h ?? token.traders24h, Number.NaN),
    liquidityRatio: toFiniteNumber(token.liquidityRatio, Number.NaN),
    tvl: toFiniteNumber(token.tvl, Number.NaN),
    trendingScore: toFiniteNumber(token.trendingScore ?? token.score, Number.NaN),
    holderConcentration: toFiniteNumber(token.top10 ?? token.top20 ?? token.top50 ?? token.dom, Number.NaN),
    lowLiquidity: Boolean(token.lowLiquidity),
    freezeFlag: Boolean(token.globalFreeze || token.freeze || token.frozen || token.canFreeze),
    verified: Boolean(token.verified || token.kyc),
    logoUrl: tokenLogoUrl(token),
    slug: token.slug || "",
    md5: String(token.md5 || token._id || "").trim(),
    updatedAt: token.lastUpdated || token.updatedAt || "",
    // dateon from xrpl.to is already in milliseconds (13-digit unix ms timestamp)
    createdAt: token.dateon ? (token.dateon > 1e12 ? token.dateon : token.dateon * 1000) : 0,
    source: String(token.user || token.domain || "").trim(),
    tags: Array.isArray(token.tags) ? token.tags : []
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

function scoreAmmPoolHealth(pool = {}) {
  const reasons = [];
  let score = 50;
  const tvl = toFiniteNumber(pool.tvl, Number.NaN);
  const volume = toFiniteNumber(pool.volume24hAmm, Number.NaN);
  const lpHolders = toFiniteNumber(pool.lpHolders, Number.NaN);
  const trustlines = toFiniteNumber(pool.trustlines, Number.NaN);
  const holders = toFiniteNumber(pool.holders, Number.NaN);
  const burned = toFiniteNumber(pool.lpBurnedPercent, Number.NaN);

  if (Number.isFinite(tvl)) {
    if (tvl >= 1_000_000) { score += 18; reasons.push("Deep TVL"); }
    else if (tvl >= 200_000) { score += 14; reasons.push("Solid TVL"); }
    else if (tvl >= 75_000) { score += 9; reasons.push("Moderate TVL"); }
    else if (tvl >= 25_000) { score += 3; reasons.push("Developing TVL"); }
    else { score -= 10; reasons.push("Thin TVL"); }
  } else {
    score -= 8;
    reasons.push("Missing TVL");
  }

  if (Number.isFinite(volume) && Number.isFinite(tvl) && tvl > 0) {
    const turnover = volume / tvl;
    if (turnover >= 0.005 && turnover <= 0.35) { score += 12; reasons.push("Healthy turnover"); }
    else if (turnover >= 0.001 && turnover < 0.005) { score += 4; reasons.push("Light turnover"); }
    else if (turnover > 0.35 && turnover <= 1) { score -= 4; reasons.push("High churn"); }
    else if (turnover > 1) { score -= 10; reasons.push("Extreme churn"); }
    else { score -= 6; reasons.push("Low pool flow"); }
  } else if (Number.isFinite(volume) && volume > 1000) {
    score += 3;
    reasons.push("Active volume");
  }

  if (Number.isFinite(lpHolders)) {
    if (lpHolders >= 400) { score += 12; reasons.push("Distributed LP base"); }
    else if (lpHolders >= 100) { score += 8; reasons.push("Good LP diversity"); }
    else if (lpHolders >= 25) { score += 3; reasons.push("Some LP diversity"); }
    else if (lpHolders < 10) { score -= 10; reasons.push("Very few LP holders"); }
    else { score -= 3; reasons.push("Few LP holders"); }
  }

  if (Number.isFinite(holders)) {
    if (holders >= 5000) score += 5;
    else if (holders >= 1000) score += 3;
  }
  if (Number.isFinite(trustlines)) {
    if (trustlines >= 5000) score += 5;
    else if (trustlines >= 1000) score += 3;
  }
  if (pool.verified) { score += 8; reasons.push("Verified asset"); }
  else { score -= 3; reasons.push("Unverified asset"); }
  if (pool.lowLiquidity) { score -= 12; reasons.push("Low liquidity flag"); }
  if (Number.isFinite(burned)) {
    if (burned > 80) { score -= 5; reasons.push("Very high LP burn"); }
    else if (burned > 40) { score -= 2; reasons.push("Large LP burn"); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 82 ? "Strong"
    : score >= 62 ? "Watch"
      : score >= 45 ? "Thin"
        : "Fragile";
  return { level, score, reasons };
}

function scoreAmmIssuerRisk(pool = {}) {
  const reasons = [];
  let score = 0;
  const holders = toFiniteNumber(pool.holders, Number.NaN);
  const trustlines = toFiniteNumber(pool.trustlines, Number.NaN);

  if (!pool.issuer) { score += 2; reasons.push("Issuer unknown"); }
  if (!pool.verified) { score += 2; reasons.push("Unverified issuer"); }
  if (Number.isFinite(holders) && holders < 100) { score += 1; reasons.push("Low holder base"); }
  if (Number.isFinite(trustlines) && trustlines < 100) { score += 1; reasons.push("Few trust lines"); }
  if (pool.lowLiquidity) { score += 1; reasons.push("Low liquidity flag"); }

  const level = score >= 4 ? "Issuer Risk" : score >= 2 ? "Issuer Watch" : "Known Issuer";
  return { level, score, reasons };
}

function healthBadgeMarkup(health = {}) {
  const cls = health.level === "Strong" ? "verified"
    : health.level === "Fragile" ? "danger"
      : health.level === "Thin" ? "warning"
        : "";
  const title = health.reasons?.length ? ` title="${escapeHtml(health.reasons.join(" | "))}"` : "";
  return `
    <span class="market-token-badge ${cls}"${title}>${escapeHtml(health.level || "Watch")} ${Number.isFinite(health.score) ? health.score : "—"}</span>
    ${health.reasons?.length ? `<span class="market-risk-reasons">${escapeHtml(health.reasons.slice(0, 2).join(" • "))}</span>` : ""}
  `;
}

function issuerRiskBadgeMarkup(risk = {}) {
  const cls = risk.level === "Known Issuer" ? "verified"
    : risk.level === "Issuer Risk" ? "danger"
      : "warning";
  const title = risk.reasons?.length ? ` title="${escapeHtml(risk.reasons.join(" | "))}"` : "";
  return `
    <span class="market-token-badge ${cls}"${title}>${escapeHtml(risk.level || "Issuer Watch")}</span>
    ${risk.reasons?.length ? `<span class="market-risk-reasons">${escapeHtml(risk.reasons.slice(0, 2).join(" • "))}</span>` : ""}
  `;
}

function ammTableLegendMarkup() {
  const items = [
    ["#", "Rank by the loaded market feed. Lower numbers usually mean larger TVL in this view."],
    ["Pool Pair", "The issued asset paired against XRP. Always verify the issuer before trusting the ticker."],
    ["AMM Account", "The XRPL account that represents the automated market maker pool."],
    ["TVL", "Estimated total value locked in the pool. Higher depth can reduce slippage, but does not remove issuer risk."],
    ["24h AMM Volume", "Approximate pool flow over the last day, shown in XRP from the market feed."],
    ["Turnover", "24h AMM volume divided by TVL. Very high turnover can mean active trading or unstable churn."],
    ["Fee", "The pool trading fee LPs may earn from swaps. High fees can also signal risk or thin markets."],
    ["LP Holders", "How many accounts hold LP tokens. Few LPs means more concentration risk."],
    ["LP Burned", "Percent of LP tokens reported burned. Large values can change governance and exit assumptions."],
    ["Holders", "Estimated token holder count for the issued asset."],
    ["Trust Lines", "How many XRPL trust lines exist for that issued asset."],
    ["Status", "Whether the market feed marks the asset as verified, tracked, or low liquidity."],
    ["Health", "IkeLedger pool score based on TVL, turnover, LP distribution, holders, trust lines, and liquidity flags."],
    ["Issuer", "Issuer quality signal. Unverified issuers deserve extra review before trading or providing liquidity."],
    ["Risk", "Plain-language pool risk based on liquidity, issuer status, LP concentration, and volume quality."],
    ["Watch", "Adds the pool to your local watchlist for faster review."],
    ["Links", "External token and pool pages for deeper verification."]
  ];

  return `
    <details class="amm-table-legend">
      <summary>
        <span>Column Legend</span>
        <em>What every AMM / LP metric means</em>
      </summary>
      <div class="amm-table-legend-grid">
        ${items.map(([label, detail]) => `
          <div>
            <strong>${escapeHtml(label)}</strong>
            <p>${escapeHtml(detail)}</p>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function calculateImpermanentLoss(priceMovePct) {
  const ratio = Math.max(0.0001, 1 + toFiniteNumber(priceMovePct, 0) / 100);
  return ((2 * Math.sqrt(ratio)) / (1 + ratio) - 1) * 100;
}

function getAmmToolPool() {
  const items = state.topAmmPools.items || [];
  if (!items.length) return null;
  const selected = items.find((pool) => pool.id === state.ammTools.selectedPoolId);
  if (selected) return selected;
  const watched = items.find((pool) => state.ammWatchlist.has(pool.id));
  const fallback = watched || items[0];
  state.ammTools.selectedPoolId = fallback.id;
  return fallback;
}

function ammWhaleAlerts(items = []) {
  const alerts = [];
  for (const pool of items) {
    const tvl = toFiniteNumber(pool.tvl, Number.NaN);
    const volume = toFiniteNumber(pool.volume24hAmm, Number.NaN);
    const lpHolders = toFiniteNumber(pool.lpHolders, Number.NaN);
    const burned = toFiniteNumber(pool.lpBurnedPercent, Number.NaN);
    const turnover = Number.isFinite(volume) && Number.isFinite(tvl) && tvl > 0 ? volume / tvl : Number.NaN;
    if (Number.isFinite(tvl) && tvl >= 250_000 && Number.isFinite(lpHolders) && lpHolders < 30) {
      alerts.push({ tone: "warning", title: `${pool.symbol} LP concentration`, detail: `${formatUsd(tvl)} TVL spread across ${formatCompactNumber(lpHolders, 0)} LP holders.` });
    }
    if (Number.isFinite(turnover) && turnover > 1.25) {
      alerts.push({ tone: "warning", title: `${pool.symbol} high churn`, detail: `24h AMM volume is ${(turnover * 100).toFixed(0)}% of TVL. Check for wash trading or fast liquidity rotation.` });
    }
    if (Number.isFinite(burned) && burned > 40) {
      alerts.push({ tone: "medium", title: `${pool.symbol} LP burn concentration`, detail: `${formatUnsignedPercent(burned)} LP burned. Verify what that means for exit depth and fee voting.` });
    }
    if (pool.lowLiquidity) {
      alerts.push({ tone: "danger", title: `${pool.symbol} low-liquidity flag`, detail: "Use smaller test actions and compare AMM price against order-book price." });
    }
  }
  return alerts.slice(0, 5);
}

// ── XRPScan token normalizer ──────────────────────────────────────────
function normalizeXRPScanToken(token = {}, index = 0) {
  const rawCurrency = String(token.currency || "").trim();
  const symbol      = String(token.code || decodeCurrencyCode(rawCurrency) || "").trim();
  const issuer      = token.issuer || "";
  const id          = `${rawCurrency}.${issuer}`;
  const m           = token.metrics || {};
  const metaTok     = token.meta?.token  || {};
  const metaIss     = token.meta?.issuer || {};
  const ia          = token.IssuingAccount || {};
  const logoUrl     = String(metaTok.icon || metaIss.icon || "").trim();
  return {
    rank:        index + 1,
    symbol:      symbol || decodeCurrencyCode(rawCurrency),
    currency:    decodeCurrencyCode(rawCurrency),
    rawCurrency,
    issuer,
    id,
    priceXrp:    toFiniteNumber(m.price    ?? token.price,    Number.NaN),
    priceUsd:    Number.NaN,
    change5m:    Number.NaN,
    change1h:    Number.NaN,
    change24h:   Number.NaN,
    change7d:    Number.NaN,
    marketCap:   toFiniteNumber(m.marketcap  ?? token.marketcap, Number.NaN),
    holders:     toFiniteNumber(m.holders    ?? token.holders,   Number.NaN),
    trustlines:  toFiniteNumber(m.trustlines, Number.NaN),
    volume24h:   toFiniteNumber(m.volume_24h, Number.NaN),
    tradeCount:  toFiniteNumber(m.exchanges_24h, Number.NaN),
    uniqueTraders: toFiniteNumber(m.takers_24h, Number.NaN),
    liquidityRatio: Number.NaN,
    tvl:         Number.NaN,
    trendingScore:  toFiniteNumber(token.score, Number.NaN),
    holderConcentration: Number.NaN,
    lowLiquidity: false,
    freezeFlag:  false,
    verified:    Boolean(metaIss.kyc || ia.verified || (metaTok.trust_level ?? 0) >= 3),
    logoUrl,
    slug: "",
    md5:  "",
    updatedAt:  token.updatedAt || "",
    createdAt:  token.createdAt ? new Date(token.createdAt).getTime() : 0,
    source:     String(ia.name || ia.domain || metaTok.name || "").trim(),
    tags:       []
  };
}

// ── XRPL WebSocket live price for a single token ──────────────────────
async function fetchLiveXrplTokenPrice(token) {
  const network = getWalletState().network || DEFAULT_NETWORK;
  const { rawCurrency, issuer } = token;
  if (!rawCurrency || !issuer) return null;

  // AMM pool gives most accurate spot price
  try {
    const r = await requestXrplCommand(network, {
      command: "amm_info",
      asset:  { currency: "XRP" },
      asset2: { currency: rawCurrency, issuer }
    });
    const amm = r?.amm;
    if (amm) {
      const xrp = Number(amm.amount || 0) / 1e6;
      const tok = Number(amm.amount2?.value || 0);
      if (xrp > 0 && tok > 0) return { priceXrp: xrp / tok, source: "amm" };
    }
  } catch { /* fall through */ }

  // Order-book best ask
  try {
    const r = await requestXrplCommand(network, {
      command: "book_offers",
      taker_pays: { currency: "XRP" },
      taker_gets: { currency: rawCurrency, issuer },
      limit: 1
    });
    const o = r?.offers?.[0];
    if (o) {
      const xrp = Number(o.TakerPays || 0) / 1e6;
      const tok = Number(o.TakerGets?.value || 0);
      if (xrp > 0 && tok > 0) return { priceXrp: xrp / tok, source: "book" };
    }
  } catch { /* */ }

  return null;
}

// ── Batch-refresh live prices for currently visible tokens ────────────
async function refreshVisibleTokenPrices() {
  const { items, livePrices } = state.topIssuedAssets;
  if (!items.length) return;
  const now = Date.now();
  const visibleLimit = Math.min(state.topIssuedVisibleCount, LIVE_TOKEN_PRICE_VISIBLE_LIMIT);
  const visibleItems = items.slice(0, visibleLimit);
  const watchedItems = items.filter((token) => state.tokenWatchlist.has(token.id)).slice(0, 20);
  const candidates = [...new Map([...visibleItems, ...watchedItems].map((token) => [token.id, token])).values()];
  const toFetch = candidates.filter(t => {
    const c = livePrices.get(t.id);
    return !c || now - c.fetchedAt > LIVE_TOKEN_PRICE_STALE_MS;
  });
  if (!toFetch.length) return;

  const batchSize = 3;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    await Promise.allSettled(toFetch.slice(i, i + batchSize).map(async t => {
      const r = await fetchLiveXrplTokenPrice(t);
      if (r) livePrices.set(t.id, { ...r, fetchedAt: Date.now() });
    }));
    if (state.activePage === "tokens") renderTopIssuedTokens();
  }
}

function showTokenAnalytics(tokenId) {
  const token = state.topIssuedAssets.items.find(t => t.id === tokenId);
  if (!token) return;

  let modal = document.getElementById("tokenAnalyticsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "tokenAnalyticsModal";
    modal.className = "token-analytics-modal";
    document.body.appendChild(modal);
  }

  const liveEntry = state.topIssuedAssets.livePrices.get(token.id);
  const price = liveEntry ? liveEntry.priceXrp : token.priceXrp;
  const risk  = scoreIssuedAssetRisk(token);
  const watched = state.tokenWatchlist.has(token.id);

  const pctBadge = (v, label) => {
    if (!Number.isFinite(v)) return `<span class="ta-pct-badge muted">${label} —</span>`;
    const cls  = v >= 0 ? "pct-pos" : "pct-neg";
    const sign = v >= 0 ? "+" : "";
    return `<span class="ta-pct-badge ${cls}">${label} ${sign}${v.toFixed(2)}%</span>`;
  };

  const stat = (label, val) =>
    `<div class="ta-stat"><span class="ta-stat-label">${escapeHtml(label)}</span><strong>${val}</strong></div>`;

  modal.innerHTML = `
    <div class="ta-backdrop"></div>
    <div class="ta-panel glass-card">
      <div class="ta-header">
        ${tokenLogoMarkup(token, token.symbol)}
        <div class="ta-title">
          <h3>${escapeHtml(token.symbol)}${token.verified ? ' <span class="tok-verified-dot" title="Verified">✓</span>' : ""}</h3>
          <span class="muted">${escapeHtml(token.source || formatAddress(token.issuer))}</span>
        </div>
        <button class="ghost ta-watch-btn${watched ? " is-watched" : ""}" data-analytics-watch="${escapeHtml(token.id)}" type="button" title="${watched ? "Unwatch" : "Watch"}">${watched ? "★ Watching" : "☆ Watch"}</button>
        <button class="ghost ta-close" id="closeTokenAnalytics" type="button" aria-label="Close">✕</button>
      </div>

      <div class="ta-price-row">
        <span class="ta-price">${Number.isFinite(price) ? escapeHtml(formatXrpAmount(price)) + " XRP" : "—"}</span>
        ${pctBadge(token.change5m, "5M")}
        ${pctBadge(token.change1h, "1H")}
        ${pctBadge(token.change24h, "24H")}
        ${pctBadge(token.change7d, "7D")}
      </div>

      <div class="ta-stats-grid">
        ${stat("Market Cap",  Number.isFinite(token.marketCap) ? `XRP ${escapeHtml(formatXrpAmount(token.marketCap))}` : "—")}
        ${stat("24H Volume",  Number.isFinite(token.volume24h) ? `XRP ${escapeHtml(formatXrpAmount(token.volume24h))}` : "—")}
        ${stat("Holders",     formatCompactNumber(token.holders, 1))}
        ${stat("Trades 24H",  formatCompactNumber(token.tradeCount, 0))}
        ${stat("TVL / Liq.",  Number.isFinite(token.tvl) && token.tvl > 0 ? `XRP ${escapeHtml(formatXrpAmount(token.tvl))}` : Number.isFinite(token.liquidityRatio) && token.liquidityRatio > 0 ? `XRP ${escapeHtml(formatXrpAmount(token.liquidityRatio))}` : "—")}
        ${stat("Trust Lines", formatCompactNumber(token.trustlines, 1))}
        ${stat("Age",         escapeHtml(formatAge(token.createdAt)))}
        ${stat("Risk",        `<span class="risk-label-${risk.level === "Lower Risk" ? "low" : risk.level === "High Risk" ? "high" : "med"}">${escapeHtml(risk.level)}</span>`)}
      </div>

      ${risk.reasons.length ? `<div class="ta-risk-tags">${risk.reasons.map(r => `<span class="ta-risk-tag">${escapeHtml(r)}</span>`).join("")}</div>` : ""}

      <div class="ta-actions">
        <button class="ta-action-btn" data-ta-open-dex="${escapeHtml(token.id)}" type="button">View Chart</button>
        ${token.slug ? `<a class="ta-action-btn ghost" href="https://xrpl.to/token/${encodeURIComponent(token.slug)}" target="_blank" rel="noopener noreferrer">xrpl.to ↗</a>` : ""}
      </div>
    </div>`;

  modal.classList.add("is-open");

  modal.querySelector(".ta-backdrop")?.addEventListener("click", () => modal.classList.remove("is-open"));
  document.getElementById("closeTokenAnalytics")?.addEventListener("click", () => modal.classList.remove("is-open"));
  modal.querySelector("[data-analytics-watch]")?.addEventListener("click", (e) => {
    toggleWatchlist("token", token.id);
    const btn = e.currentTarget;
    const nowWatched = state.tokenWatchlist.has(token.id);
    btn.textContent = nowWatched ? "★ Watching" : "☆ Watch";
    btn.classList.toggle("is-watched", nowWatched);
  });
  modal.querySelector("[data-ta-open-dex]")?.addEventListener("click", () => {
    state.dex.selectedTokenId = token.id;
    modal.classList.remove("is-open");
    setActivePage("dex");
  });
}

function renderTopIssuedTokens() {
  if (!refs.topIssuedTokensPanel) return;
  const { items, loading, error, fetchedAt } = state.topIssuedAssets;
  if (refs.refreshTopIssuedTokensButton) {
    refs.refreshTopIssuedTokensButton.disabled = loading;
    refs.refreshTopIssuedTokensButton.textContent = loading ? "Loading…" : "Refresh";
  }

  if (!items.length && loading) {
    refs.topIssuedTokensPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>Loading issued assets…</strong>
        <p class="muted">Fetching live price, volume, and market cap data from XRPL.</p>
      </div>`;
    return;
  }
  if (!items.length) {
    refs.topIssuedTokensPanel.innerHTML = `
      <div class="market-token-empty">
        <strong>${error ? "Market data unavailable" : "Loading soon"}</strong>
        <p class="muted">${error ? escapeHtml(error) : "Live XRPL issued-asset data will appear here."}</p>
      </div>`;
    return;
  }

  // ── Aggregate market stats ───────────────────────────────────────────
  const totalMktCap  = items.reduce((s, t) => s + (Number.isFinite(t.marketCap)  ? t.marketCap  : 0), 0);
  const totalVol24h  = items.reduce((s, t) => s + (Number.isFinite(t.volume24h)  ? t.volume24h  : 0), 0);
  const totalTvl     = items.reduce((s, t) => s + (Number.isFinite(t.tvl)        ? t.tvl        : 0), 0);
  const totalTraders = items.reduce((s, t) => s + (Number.isFinite(t.uniqueTraders) ? t.uniqueTraders : 0), 0);
  const updatedLabel = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "cached";
  const gainers     = items.filter(t => Number.isFinite(t.change24h) && t.change24h > 0).length;
  const losers      = items.filter(t => Number.isFinite(t.change24h) && t.change24h < 0).length;
  const buySellBase = gainers + losers || 1;
  const buyPct      = Math.round(gainers / buySellBase * 100);
  const topNew      = [...items].filter(t => t.createdAt > 0).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  // ── Tags across all items ────────────────────────────────────────────
  const tagCount = new Map();
  for (const t of items) {
    for (const tag of (t.tags || [])) {
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    }
  }
  const popularTags = [...tagCount.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag]) => tag);

  // ── Filter logic ─────────────────────────────────────────────────────
  const query    = state.topIssuedFilter.trim().toLowerCase();
  const tagQuery = state.topIssuedTagFilter;
  const tab      = state.topIssuedTab || "all";

  let filteredItems = items;
  if (query) {
    filteredItems = filteredItems.filter(t =>
      t.symbol.toLowerCase().includes(query)
      || t.currency.toLowerCase().includes(query)
      || t.source.toLowerCase().includes(query)
      || t.issuer.toLowerCase().includes(query)
    );
  }
  if (tagQuery) {
    filteredItems = filteredItems.filter(t => t.tags.includes(tagQuery));
  }
  if (tab === "trending") {
    filteredItems = [...filteredItems].sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0));
  } else if (tab === "new") {
    filteredItems = [...filteredItems].filter(t => t.createdAt > 0).sort((a, b) => b.createdAt - a.createdAt);
  } else if (tab === "gainers") {
    filteredItems = [...filteredItems].sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
  }

  const visibleItems = filteredItems.slice(0, state.topIssuedVisibleCount);

  // ── Trending strip (top 5 by trendingScore) ──────────────────────────
  const trendingTokens = [...items]
    .filter(t => Number.isFinite(t.trendingScore) && t.trendingScore > 0)
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, 6);

  const trendingStrip = trendingTokens.length ? `
    <div class="tokens-trending-strip">
      <div class="tokens-trending-label">
        <span>Trending</span>
      </div>
      <div class="tokens-trending-cards">
        ${trendingTokens.map((t, i) => {
          const c24 = toFiniteNumber(t.change24h, 0);
          const cls = c24 >= 0 ? "pct-pos" : "pct-neg";
          const sign = c24 >= 0 ? "+" : "";
          return `
          <button class="tokens-trend-card" data-trend-token="${escapeHtml(t.id)}" type="button">
            <div class="ttc-rank">${i + 1}</div>
            ${tokenLogoMarkup(t, t.symbol)}
            <div class="ttc-info">
              <strong>${escapeHtml(t.symbol)}</strong>
              <span class="${cls}">${sign}${c24.toFixed(1)}%</span>
            </div>
          </button>`;
        }).join("")}
      </div>
    </div>
  ` : "";

  // ── Watchlist strip ───────────────────────────────────────────────────
  const watchedIds = [...state.tokenWatchlist];
  const watchedTokens = watchedIds.map(id => items.find(t => t.id === id)).filter(Boolean);
  const watchlistStrip = watchedTokens.length ? `
    <div class="tok-watchlist-strip">
      <div class="tok-watchlist-label">★ Watching</div>
      <div class="tok-watchlist-cards">
        ${watchedTokens.map(t => {
          const liveEntry = state.topIssuedAssets.livePrices.get(t.id);
          const price = liveEntry ? liveEntry.priceXrp : t.priceXrp;
          const c24 = toFiniteNumber(t.change24h, 0);
          const cls = c24 >= 0 ? "pct-pos" : "pct-neg";
          return `
          <div class="tok-watch-card" data-analytics-token="${escapeHtml(t.id)}" role="button" tabindex="0">
            ${tokenLogoMarkup(t, t.symbol)}
            <div class="twc-info">
              <strong>${escapeHtml(t.symbol)}</strong>
              <span>${Number.isFinite(price) ? escapeHtml(formatXrpAmount(price)) + " XRP" : "—"}</span>
              <span class="${cls}">${c24 >= 0 ? "+" : ""}${c24.toFixed(2)}%</span>
            </div>
            <button class="twc-remove" data-watch-token="${escapeHtml(t.id)}" type="button" title="Unwatch" aria-label="Remove ${escapeHtml(t.symbol)} from watchlist">×</button>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // ── Table rows ────────────────────────────────────────────────────────
  const rows = visibleItems.map((token) => {
    const liveEntry   = state.topIssuedAssets.livePrices.get(token.id);
    const displayPrice = liveEntry ? liveEntry.priceXrp : token.priceXrp;
    const isLive      = Boolean(liveEntry);
    const sourceUrl   = token.slug ? `https://xrpl.to/token/${encodeURIComponent(token.slug)}` : "";
    const risk        = scoreIssuedAssetRisk(token);
    const watched     = state.tokenWatchlist.has(token.id);
    const riskDotCls  = risk.level === "Lower Risk" ? "risk-dot-low" : risk.level === "High Risk" ? "risk-dot-high" : "risk-dot-med";
    const riskTitle   = risk.reasons.slice(0, 3).join(" · ");
    const liquidityStr = Number.isFinite(token.liquidityRatio) && token.liquidityRatio > 0
      ? `XRP ${escapeHtml(formatXrpAmount(token.liquidityRatio))}`
      : Number.isFinite(token.tvl) && token.tvl > 0
        ? `XRP ${escapeHtml(formatXrpAmount(token.tvl))}`
        : "—";
    const priceSourceTitle = isLive
      ? `Live from XRPL ${liveEntry.source === "amm" ? "AMM pool" : "order book"}`
      : "Aggregated price";
    return `
      <tr>
        <td class="rank-cell">${token.rank}</td>
        <td class="token-id-cell">
          <div class="market-token-identity">
            ${tokenLogoMarkup(token, token.symbol)}
            <div class="mti-text">
              <div class="mti-top">
                <strong>${escapeHtml(token.symbol)}</strong>
                <span class="risk-dot ${riskDotCls}" title="${escapeHtml(riskTitle)}"></span>
                ${token.verified ? '<span class="tok-verified-dot" title="Verified">✓</span>' : ""}
                <button class="star-watch${watched ? " is-watched" : ""}" type="button" data-watch-token="${escapeHtml(token.id)}" title="${watched ? "Watching" : "Watch"}">${watched ? "★" : "☆"}</button>
              </div>
              <span class="token-source-name">${escapeHtml(token.source || formatAddress(token.issuer))}</span>
            </div>
          </div>
        </td>
        <td class="price-xrp-cell" title="${escapeHtml(priceSourceTitle)}">
          <strong>${escapeHtml(formatXrpAmount(displayPrice))}</strong>
          ${isLive ? `<span class="price-live-dot" title="${escapeHtml(priceSourceTitle)}">◉</span>` : ""}
        </td>
        <td class="sparkline-cell">${tokenSparklineSvg(token)}</td>
        <td class="pct-cell">${pctChip(token.change5m)}</td>
        <td class="pct-cell">${pctChip(token.change1h)}</td>
        <td class="pct-cell">${pctChip(token.change24h)}</td>
        <td class="pct-cell">${pctChip(token.change7d)}</td>
        <td class="num-cell">XRP ${escapeHtml(formatXrpAmount(token.volume24h))}</td>
        <td class="num-cell muted-cell">${escapeHtml(formatAge(token.createdAt))}</td>
        <td class="num-cell">${formatCompactNumber(token.tradeCount, 0)}</td>
        <td class="num-cell">${liquidityStr}</td>
        <td class="num-cell">XRP ${escapeHtml(formatXrpAmount(token.marketCap))}</td>
        <td class="num-cell">${formatCompactNumber(token.holders, 1)}</td>
        <td class="source-cell">${sourceUrl
          ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="source-link">${escapeHtml(token.source || "↗")}</a>`
          : escapeHtml(token.source || "—")}</td>
      </tr>`;
  }).join("");

  refs.topIssuedTokensPanel.innerHTML = `
    <div class="tokens-market-stats">
      <div class="tms-item">
        <span class="tms-label">MCAP / TVL</span>
        <strong>XRP ${escapeHtml(formatXrpAmount(totalMktCap))}</strong>
        <span class="tms-sub">TVL XRP ${escapeHtml(formatXrpAmount(totalTvl))}</span>
      </div>
      <div class="tms-item">
        <span class="tms-label">24H VOLUME</span>
        <strong>XRP ${escapeHtml(formatXrpAmount(totalVol24h))}</strong>
        <span class="tms-sub">${gainers} up · ${losers} down</span>
      </div>
      <div class="tms-item">
        <span class="tms-label">24H TRADERS</span>
        <strong>${formatCompactNumber(totalTraders, 1)}</strong>
        <div class="tms-sentiment-bar">
          <div class="tms-buy-bar" style="width:${buyPct}%"></div>
          <div class="tms-sell-bar" style="width:${100 - buyPct}%"></div>
        </div>
        <span class="tms-sub">${buyPct}% Buy · ${100 - buyPct}% Sell</span>
      </div>
      ${trendingTokens[0] ? `
      <div class="tms-item tms-trending-mini">
        <span class="tms-label">TRENDING</span>
        <div class="tms-mini-token">
          ${tokenLogoMarkup(trendingTokens[0], trendingTokens[0].symbol)}
          <div><strong>${escapeHtml(trendingTokens[0].symbol)}</strong>${pctChip(trendingTokens[0].change24h)}</div>
        </div>
        ${trendingTokens[1] ? `<div class="tms-mini-token">
          ${tokenLogoMarkup(trendingTokens[1], trendingTokens[1].symbol)}
          <div><strong>${escapeHtml(trendingTokens[1].symbol)}</strong>${pctChip(trendingTokens[1].change24h)}</div>
        </div>` : ""}
      </div>` : ""}
      ${topNew ? `
      <div class="tms-item">
        <span class="tms-label">NEW LAUNCHES</span>
        <div class="tms-mini-token">
          ${tokenLogoMarkup(topNew, topNew.symbol)}
          <div>
            <strong>${escapeHtml(topNew.symbol)}</strong>
            <span class="tms-sub">${escapeHtml(formatAge(topNew.createdAt))} ago</span>
          </div>
        </div>
      </div>` : ""}
      <div class="tms-item tms-updated">
        <span class="tms-label">UPDATED</span>
        <strong>${escapeHtml(updatedLabel)}</strong>
      </div>
    </div>

    ${trendingStrip}

    ${watchlistStrip}

    <div class="tokens-controls-row">
      <div class="tokens-tab-bar">
        <button class="ttab-btn${tab === "all"      ? " active" : ""}" data-tab="all"      type="button">All</button>
        <button class="ttab-btn${tab === "trending" ? " active" : ""}" data-tab="trending" type="button">Trending</button>
        <button class="ttab-btn${tab === "new"      ? " active" : ""}" data-tab="new"      type="button">New</button>
        <button class="ttab-btn${tab === "gainers"  ? " active" : ""}" data-tab="gainers"  type="button">Gainers</button>
      </div>
      <input id="topIssuedTokenFilter" class="tokens-search-input" type="search" placeholder="Search token or issuer…" value="${escapeHtml(state.topIssuedFilter)}" autocomplete="off" />
    </div>

    ${popularTags.length ? `
    <div class="tokens-tag-row" aria-label="Filter by tag">
      <button class="tag-chip${!tagQuery ? " active" : ""}" data-tag="" type="button">All</button>
      ${popularTags.map(tag => `<button class="tag-chip${tagQuery === tag ? " active" : ""}" data-tag="${escapeHtml(tag)}" type="button">${escapeHtml(tag)}</button>`).join("")}
    </div>` : ""}

    ${error ? `<p class="market-token-note">${escapeHtml(error)} Showing cached data.</p>` : ""}

    <div class="issued-token-table-wrap" role="region" aria-label="XRPL issued assets" tabindex="0">
      <table class="issued-token-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Token</th>
            <th>Price (XRP)</th>
            <th>Trend 24H</th>
            <th>5M%</th>
            <th>1H%</th>
            <th>24H%</th>
            <th>7D%</th>
            <th>Volume 24h</th>
            <th>Created</th>
            <th>Trades</th>
            <th>Liquidity</th>
            <th>Mkt Cap</th>
            <th>Holders</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="15" class="empty-table-cell">No assets match this filter.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="market-load-row">
      <span>${items.length} assets · ${state.tokenWatchlist.size} watched</span>
      ${visibleItems.length < filteredItems.length
        ? `<button id="loadMoreTopIssuedTokensButton" class="ghost" type="button">Load ${Math.min(MARKET_VISIBLE_STEP, filteredItems.length - visibleItems.length)} more</button>`
        : `<span class="market-load-complete">All ${filteredItems.length} shown</span>`}
    </div>
  `;

  refs.topIssuedTokensPanel.querySelector("#topIssuedTokenFilter")
    ?.addEventListener("input", (e) => {
      state.topIssuedFilter = e.target.value || "";
      state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;
      renderTopIssuedTokens();
    });

  refs.topIssuedTokensPanel.querySelector("#loadMoreTopIssuedTokensButton")
    ?.addEventListener("click", () => {
      state.topIssuedVisibleCount = Math.min(state.topIssuedVisibleCount + MARKET_VISIBLE_STEP, filteredItems.length);
      renderTopIssuedTokens();
    });

  refs.topIssuedTokensPanel.querySelectorAll("[data-watch-token]").forEach((btn) => {
    btn.addEventListener("click", () => toggleWatchlist("token", btn.dataset.watchToken || ""));
  });

  refs.topIssuedTokensPanel.querySelectorAll(".ttab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.topIssuedTab = btn.dataset.tab || "all";
      state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;
      renderTopIssuedTokens();
    });
  });

  refs.topIssuedTokensPanel.querySelectorAll(".tag-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.topIssuedTagFilter = btn.dataset.tag || "";
      state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;
      renderTopIssuedTokens();
    });
  });

  refs.topIssuedTokensPanel.querySelectorAll(".tokens-trend-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tokenId = btn.dataset.trendToken || "";
      const tok = items.find(t => t.id === tokenId);
      if (tok) {
        state.topIssuedFilter = tok.symbol;
        state.topIssuedVisibleCount = MARKET_VISIBLE_STEP;
        renderTopIssuedTokens();
      }
    });
  });

  // Watchlist card clicks → analytics modal
  refs.topIssuedTokensPanel.querySelectorAll("[data-analytics-token]").forEach((card) => {
    const openAnalytics = (e) => {
      if (e.target.closest("[data-watch-token]")) return;
      showTokenAnalytics(card.dataset.analyticsToken || "");
    };
    card.addEventListener("click", openAnalytics);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAnalytics(e); }
    });
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

  // Check xrpl.to cache first — it has full market data (%, TVL, trending, volume)
  const cached = !forceRefresh ? getCachedTopIssuedAssets() : null;
  if (cached) {
    state.topIssuedAssets = {
      ...state.topIssuedAssets,
      fetchedAt: cached.fetchedAt,
      items: cached.items,
      loading: false,
      error: ""
    };
    renderTopIssuedTokens();
    renderDex();
    void refreshVisibleTokenPrices();
    return;
  }

  state.topIssuedAssets.loading = true;
  state.topIssuedAssets.error = "";
  renderTopIssuedTokens();

  try {
    // ── Primary: xrpl.to + XRPScan icons fetched in parallel ─────────────
    // xrpl.to has full market data (%, TVL, trending); XRPScan supplies icon URLs
    // because s1.xrpl.to CDN is hotlink-protected (403 from non-xrpl.to origins)
    const fetchXrplToPages = async () => {
      const allRaw = [];
      const pages = Math.ceil(MARKET_RESULT_LIMIT / MARKET_PAGE_SIZE);
      for (let p = 0; p < pages && allRaw.length < MARKET_RESULT_LIMIT; p++) {
        const url = `${TOP_ISSUED_ASSETS_BASE_URL}&limit=${MARKET_PAGE_SIZE}&start=${p * MARKET_PAGE_SIZE}`;
        try {
          const data = await fetchMarketJson(url);
          const batch = Array.isArray(data?.tokens) ? data.tokens : [];
          allRaw.push(...batch);
          if (batch.length < MARKET_PAGE_SIZE) break;
        } catch { break; }
      }
      return allRaw;
    };

    const [xrplToResult, xrpScanResult] = await Promise.allSettled([
      fetchXrplToPages(),
      fetchMarketJson(XRPSCAN_TOKENS_URL)
    ]);

    if (xrplToResult.status === "fulfilled" && xrplToResult.value.length) {
      // Build icon map from XRPScan: `${currency}_${issuer}` → xrplmeta icon URL
      const iconMap = new Map();
      if (xrpScanResult.status === "fulfilled" && Array.isArray(xrpScanResult.value)) {
        for (const t of xrpScanResult.value) {
          const icon = t.meta?.token?.icon || t.meta?.issuer?.icon || "";
          if (icon && t.currency && t.issuer) {
            iconMap.set(`${t.currency}_${t.issuer}`, icon);
          }
        }
      }

      // Inject xrplmeta icon into each raw xrpl.to token before normalizing
      const enriched = xrplToResult.value.map(t => {
        const icon = iconMap.get(`${t.currency}_${t.issuer}`);
        return icon ? { ...t, xrplmetaIcon: icon } : t;
      });

      const items = enriched.slice(0, MARKET_RESULT_LIMIT).map(normalizeIssuedAssetMarketToken);
      state.topIssuedAssets = {
        ...state.topIssuedAssets,
        fetchedAt: Date.now(),
        items,
        loading: false,
        error: ""
      };
      setCachedTopIssuedAssets(items);
      syncXrplToSourceStatus("Live");
      renderTopIssuedTokens();
      renderDex();
      void refreshVisibleTokenPrices();
      return;
    }
  } catch { /* fall through to XRPScan-only backup */ }

  try {
    // ── Fallback: XRPScan only (logos + market cap + holders; no % change or TVL) ──
    const xrpScanData = await fetchMarketJson(XRPSCAN_TOKENS_URL);
    if (Array.isArray(xrpScanData) && xrpScanData.length) {
      const sorted = [...xrpScanData].sort((a, b) =>
        Number(b.metrics?.marketcap || b.marketcap || 0) -
        Number(a.metrics?.marketcap || a.marketcap || 0)
      );
      const items = sorted.map(normalizeXRPScanToken);
      state.topIssuedAssets = {
        ...state.topIssuedAssets,
        fetchedAt: Date.now(),
        items,
        loading: false,
        error: "Using fallback data — % change and TVL unavailable."
      };
      setCachedXRPScanTokens(items);
      syncXrplToSourceStatus("Cached");
      renderTopIssuedTokens();
      renderDex();
      void refreshVisibleTokenPrices();
      return;
    }
  } catch { /* both sources failed */ }

  // ── Both failed: use any stale cache ─────────────────────────────────
  const cachedFallback = getCachedTopIssuedAssets() || getCachedXRPScanTokens();
  state.topIssuedAssets = {
    ...state.topIssuedAssets,
    fetchedAt: cachedFallback?.fetchedAt || 0,
    items: cachedFallback?.items || state.topIssuedAssets.items || [],
    loading: false,
    error: "Could not load market data."
  };
  syncXrplToSourceStatus(state.topIssuedAssets.items.length ? "Cached" : "Degraded");
  renderTopIssuedTokens();
  renderDex();
  if (state.topIssuedAssets.items.length) void refreshVisibleTokenPrices();
}

function getCachedXRPScanTokens() {
  try {
    const c = JSON.parse(localStorage.getItem(XRPSCAN_CACHE_KEY) || "null");
    if (!c?.items?.length || !c.fetchedAt) return null;
    if (Date.now() - c.fetchedAt > XRPSCAN_CACHE_MS) return null;
    return c;
  } catch { return null; }
}

function setCachedXRPScanTokens(items) {
  try {
    localStorage.setItem(XRPSCAN_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), items }));
  } catch { /* storage full */ }
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

function renderAmmTools() {
  const items = state.topAmmPools.items || [];
  const pool = getAmmToolPool();

  if (refs.ammToolPoolSelect) {
    refs.ammToolPoolSelect.innerHTML = items.length
      ? items.slice(0, MARKET_RESULT_LIMIT).map((item) => `
          <option value="${escapeHtml(item.id)}"${item.id === state.ammTools.selectedPoolId ? " selected" : ""}>${escapeHtml(item.symbol)} / XRP • ${formatUsd(item.tvl)}</option>
        `).join("")
      : '<option value="">Load AMM pools first</option>';
    refs.ammToolPoolSelect.disabled = !items.length;
  }
  if (refs.ammDepositValueInput) refs.ammDepositValueInput.value = state.ammTools.depositValue;
  if (refs.ammPriceMoveInput) refs.ammPriceMoveInput.value = state.ammTools.priceMovePct;
  if (refs.ammFeeYieldInput) refs.ammFeeYieldInput.value = state.ammTools.feeYieldPct;
  if (refs.ammExitPercentInput) refs.ammExitPercentInput.value = state.ammTools.exitPercent;
  if (refs.ammExitSlippageInput) refs.ammExitSlippageInput.value = state.ammTools.exitSlippagePct;

  if (!refs.ammToolResults || !refs.ammWhaleAlerts) return;
  if (!pool) {
    refs.ammToolResults.innerHTML = `
      <div class="market-token-empty">
        <strong>AMM intelligence waiting for pool data</strong>
        <p class="muted">Load the top AMM / LP pool feed to calculate impermanent loss, exit value, health score, issuer risk, and LP concentration signals.</p>
      </div>
    `;
    refs.ammWhaleAlerts.innerHTML = "";
    return;
  }

  const health = scoreAmmPoolHealth(pool);
  const issuerRisk = scoreAmmIssuerRisk(pool);
  const deposit = Math.max(0, toFiniteNumber(state.ammTools.depositValue, 0));
  const movePct = toFiniteNumber(state.ammTools.priceMovePct, 0);
  const feeYieldPct = Math.max(0, toFiniteNumber(state.ammTools.feeYieldPct, 0));
  const exitPct = Math.max(0, Math.min(100, toFiniteNumber(state.ammTools.exitPercent, 0)));
  const slippagePct = Math.max(0, toFiniteNumber(state.ammTools.exitSlippagePct, 0));
  const ratio = Math.max(0.0001, 1 + movePct / 100);
  const ilPct = calculateImpermanentLoss(movePct);
  const holdValue = deposit * ((1 + ratio) / 2);
  const lpValueBeforeFees = holdValue * (1 + ilPct / 100);
  const feeValue = deposit * (feeYieldPct / 100);
  const projectedLpValue = lpValueBeforeFees + feeValue;
  const exitGross = projectedLpValue * (exitPct / 100);
  const exitAfterSlippage = exitGross * (1 - slippagePct / 100);
  const remainingValue = projectedLpValue - exitGross;
  const netPnl = projectedLpValue - deposit;
  const netPnlPct = deposit > 0 ? (netPnl / deposit) * 100 : 0;
  const tvl = toFiniteNumber(pool.tvl, Number.NaN);
  const volume = toFiniteNumber(pool.volume24hAmm, Number.NaN);
  const turnover = Number.isFinite(volume) && Number.isFinite(tvl) && tvl > 0 ? (volume / tvl) * 100 : Number.NaN;

  refs.ammToolResults.innerHTML = `
    <div class="amm-tool-kpi-grid">
      <div><span>Pool health</span><strong>${health.score}/100</strong><em>${escapeHtml(health.level)}</em></div>
      <div><span>Issuer risk</span><strong>${escapeHtml(issuerRisk.level)}</strong><em>${issuerRisk.reasons.length ? escapeHtml(issuerRisk.reasons[0]) : "No major issuer warning"}</em></div>
      <div><span>Impermanent loss</span><strong>${formatPercent(ilPct)}</strong><em>vs holding both assets</em></div>
      <div><span>Projected LP value</span><strong>${formatUsd(projectedLpValue)}</strong><em>${formatPercent(netPnlPct)} net after fee estimate</em></div>
      <div><span>Exit receive</span><strong>${formatUsd(exitAfterSlippage)}</strong><em>${formatUnsignedPercent(exitPct)} exit after ${formatUnsignedPercent(slippagePct)} slippage</em></div>
      <div><span>Remainder</span><strong>${formatUsd(remainingValue)}</strong><em>Estimated value left in pool</em></div>
    </div>
    <div class="amm-tool-selected-pool">
      <div class="market-token-identity">
        ${tokenLogoMarkup(pool, pool.symbol)}
        <div>
          <strong>${escapeHtml(pool.symbol)} / XRP</strong>
          <span>TVL ${formatUsd(pool.tvl)} • AMM volume ${formatCompactNumber(pool.volume24hAmm, 1)} XRP • turnover ${Number.isFinite(turnover) ? `${turnover.toFixed(1)}%` : "n/a"}</span>
        </div>
      </div>
      <div class="amm-tool-badge-row">
        ${healthBadgeMarkup(health)}
        ${issuerRiskBadgeMarkup(issuerRisk)}
        ${riskBadgeMarkup(scoreAmmPoolRisk(pool).level, scoreAmmPoolRisk(pool).reasons)}
      </div>
    </div>
  `;

  const alerts = ammWhaleAlerts(items);
  refs.ammWhaleAlerts.innerHTML = alerts.length
    ? `
      <div class="section-top compact">
        <h4>LP Whale / Flow Signals</h4>
        <span class="mode-pill">${alerts.length} signal${alerts.length === 1 ? "" : "s"}</span>
      </div>
      <div class="amm-alert-grid">
        ${alerts.map((alert) => `
          <div class="amm-alert-item ${alert.tone}">
            <strong>${escapeHtml(alert.title)}</strong>
            <p>${escapeHtml(alert.detail)}</p>
          </div>
        `).join("")}
      </div>
    `
    : `
      <div class="amm-alert-empty">
        <strong>No major LP concentration signals in the loaded view.</strong>
        <p class="muted">Still verify issuer controls, spread, pool depth, and fee votes before depositing.</p>
      </div>
    `;
}

function onAmmToolInputChange(event) {
  const id = event?.target?.id || "";
  const value = event?.target?.value ?? "";
  if (id === "ammToolPoolSelect") state.ammTools.selectedPoolId = value;
  if (id === "ammDepositValueInput") state.ammTools.depositValue = value;
  if (id === "ammPriceMoveInput") state.ammTools.priceMovePct = value;
  if (id === "ammFeeYieldInput") state.ammTools.feeYieldPct = value;
  if (id === "ammExitPercentInput") state.ammTools.exitPercent = value;
  if (id === "ammExitSlippageInput") state.ammTools.exitSlippagePct = value;
  renderAmmTools();
}

function renderTopAmmPools() {
  if (!refs.topAmmPoolsPanel) return;
  const { items, loading, error, fetchedAt } = state.topAmmPools;
  renderAmmTools();
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
  const healthStats = items.reduce((acc, pool) => {
    const health = scoreAmmPoolHealth(pool);
    acc[health.level] = (acc[health.level] || 0) + 1;
    const tvl = toFiniteNumber(pool.tvl, Number.NaN);
    const volume = toFiniteNumber(pool.volume24hAmm, Number.NaN);
    const lpHolders = toFiniteNumber(pool.lpHolders, Number.NaN);
    const burned = toFiniteNumber(pool.lpBurnedPercent, Number.NaN);
    const turnover = Number.isFinite(volume) && Number.isFinite(tvl) && tvl > 0 ? volume / tvl : Number.NaN;
    if (Number.isFinite(turnover)) acc.turnovers.push(turnover);
    if (Number.isFinite(turnover) && turnover > 0.35) acc.highChurn += 1;
    if (Number.isFinite(lpHolders) && lpHolders < 25) acc.concentrated += 1;
    if (Number.isFinite(burned) && burned > 40) acc.lpBurnWatch += 1;
    return acc;
  }, { Strong: 0, Watch: 0, Thin: 0, Fragile: 0, turnovers: [], highChurn: 0, concentrated: 0, lpBurnWatch: 0 });
  const medianTurnover = medianNumber(healthStats.turnovers) * 100;

  const visibleItems = filteredItems.slice(0, state.topAmmVisibleCount);
  const rows = visibleItems.map((pool) => {
    const displayRank = items.indexOf(pool) >= 0 ? items.indexOf(pool) + 1 : pool.rank;
    const sourceUrl = pool.slug ? `https://xrpl.to/token/${encodeURIComponent(pool.slug)}` : "";
    const ammUrl = pool.ammAccount ? `https://xrpscan.com/account/${encodeURIComponent(pool.ammAccount)}` : "";
    const poolRisk = scoreAmmPoolRisk(pool);
    const health = scoreAmmPoolHealth(pool);
    const issuerRisk = scoreAmmIssuerRisk(pool);
    const watched = state.ammWatchlist.has(pool.id);
    const tvl = toFiniteNumber(pool.tvl, Number.NaN);
    const volume = toFiniteNumber(pool.volume24hAmm, Number.NaN);
    const turnover = Number.isFinite(volume) && Number.isFinite(tvl) && tvl > 0 ? (volume / tvl) * 100 : Number.NaN;
    const turnoverClass = Number.isFinite(turnover) && turnover > 35 ? "hot"
      : Number.isFinite(turnover) && turnover >= 0.5 ? "healthy"
        : "quiet";
    const rowHealth = String(health.level || "Watch").toLowerCase();
    const status = pool.lowLiquidity
      ? '<span class="market-token-badge warning">Low Liquidity</span>'
      : pool.verified
        ? '<span class="market-token-badge verified">Verified</span>'
        : '<span class="market-token-badge">Tracked</span>';
    return `
      <tr data-health="${escapeHtml(rowHealth)}">
        <td class="rank-cell">${displayRank}</td>
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
        <td class="amm-flow-cell ${turnoverClass}">
          <strong>${Number.isFinite(turnover) ? `${turnover.toFixed(turnover >= 10 ? 1 : 2)}%` : "n/a"}</strong>
          <span>${turnoverClass === "hot" ? "High churn" : turnoverClass === "healthy" ? "Active" : "Quiet"}</span>
        </td>
        <td>${formatAmmFee(pool.tradingFee)}</td>
        <td>${formatCompactNumber(pool.lpHolders, 1)}</td>
        <td>${formatUnsignedPercent(pool.lpBurnedPercent)}</td>
        <td>${formatCompactNumber(pool.holders, 1)}</td>
        <td>${formatCompactNumber(pool.trustlines, 1)}</td>
        <td>${status}</td>
        <td>${healthBadgeMarkup(health)}</td>
        <td>${issuerRiskBadgeMarkup(issuerRisk)}</td>
        <td>${riskBadgeMarkup(poolRisk.level, poolRisk.reasons)}</td>
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
    <div class="amm-metrics-ribbon" aria-label="AMM pool intelligence metrics">
      <div><span>Strong Pools</span><strong>${healthStats.Strong}</strong><em>score 82+</em></div>
      <div><span>Watch / Thin</span><strong>${healthStats.Watch + healthStats.Thin}</strong><em>needs review</em></div>
      <div><span>Fragile Pools</span><strong>${healthStats.Fragile}</strong><em>avoid rushing</em></div>
      <div><span>Median Turnover</span><strong>${Number.isFinite(medianTurnover) ? `${medianTurnover.toFixed(medianTurnover >= 10 ? 1 : 2)}%` : "n/a"}</strong><em>volume / TVL</em></div>
      <div><span>High Churn</span><strong>${healthStats.highChurn}</strong><em>flow over 35%</em></div>
      <div><span>LP Watch</span><strong>${healthStats.concentrated + healthStats.lpBurnWatch}</strong><em>few LPs / burn flags</em></div>
    </div>
    <label class="market-token-filter">
      <span>Filter pools</span>
      <input id="topAmmPoolFilter" type="search" placeholder="Search pair, issuer, or AMM account..." value="${escapeHtml(state.topAmmFilter)}" autocomplete="off" />
    </label>
    ${ammTableLegendMarkup()}
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
            <th>Turnover</th>
            <th>Fee</th>
            <th>LP Holders</th>
            <th>LP Burned</th>
            <th>Holders</th>
            <th>Trust Lines</th>
            <th>Status</th>
            <th>Health</th>
            <th>Issuer</th>
            <th>Risk</th>
            <th>Watch</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="17" class="empty-table-cell">No AMM pools match this filter.</td></tr>`}</tbody>
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
    const [ammData, xrpScanResult] = await Promise.allSettled([
      fetchMarketJson(TOP_AMM_POOLS_URL),
      fetchMarketJson(XRPSCAN_TOKENS_URL)
    ]);
    const data = ammData.status === "fulfilled" ? ammData.value : null;
    if (!data) throw new Error("AMM data unavailable");
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];

    const iconMap = new Map();
    if (xrpScanResult.status === "fulfilled" && Array.isArray(xrpScanResult.value)) {
      for (const t of xrpScanResult.value) {
        const icon = t.meta?.token?.icon || t.meta?.issuer?.icon || "";
        if (icon && t.currency && t.issuer) iconMap.set(`${t.currency}_${t.issuer}`, icon);
      }
    }

    const items = tokens
      .filter((token) => token.AMM || Number.parseFloat(token.tvl || "0") > 0)
      .slice(0, MARKET_RESULT_LIMIT)
      .map((t, index) => {
        const icon = iconMap.get(`${t.currency}_${t.issuer}`);
        return normalizeAmmPoolMarketToken(icon ? { ...t, xrplmetaIcon: icon } : t, index);
      });
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

function emptyNftOfferSummary() {
  return { sellOffers: 0, buyOffers: 0, lowestSell: "", highestBuy: "" };
}

function nftOfferSummary(nft) {
  if (!nft?.nftId) return emptyNftOfferSummary();
  return state.nftOfferCache.get(nft.nftId) || nft.offers || emptyNftOfferSummary();
}

function nftOfferCount(nft) {
  const offers = nftOfferSummary(nft);
  return (offers.sellOffers || 0) + (offers.buyOffers || 0);
}

async function hydrateNftOffers(nfts, force = false) {
  if (!Array.isArray(nfts) || !nfts.length) return;
  const walletState = getWalletState();
  const network = walletState.network || DEFAULT_NETWORK;
  const selected = nfts.find((nft) => nft.nftId === state.selectedNftId);
  const prioritized = [...new Map([
    ...(selected ? [selected] : []),
    ...nfts.slice(0, 12)
  ].filter(Boolean).map((nft) => [nft.nftId, nft])).values()];
  const missing = prioritized.filter((nft) => {
    if (!nft?.nftId || state.nftOfferLoading.has(nft.nftId)) return false;
    return force || !state.nftOfferCache.has(nft.nftId);
  });
  if (!missing.length) return;

  missing.forEach((nft) => state.nftOfferLoading.add(nft.nftId));
  try {
    const offerMap = await fetchNftOfferSummaries(missing, network, {
      limit: missing.length,
      timeoutMs: 12000
    });
    Object.entries(offerMap).forEach(([nftId, offers]) => {
      state.nftOfferCache.set(nftId, offers || emptyNftOfferSummary());
    });
  } catch {
    // Offer APIs can fail for NFTs with no active marketplace data. Keep media rendering usable.
  } finally {
    missing.forEach((nft) => state.nftOfferLoading.delete(nft.nftId));
  }

  if (state.activePage === "nfts" || state.activePage === "dashboard") {
    renderNfts(getWalletState());
    refreshAccountIntelligenceOverview();
  }
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
  const offers = nftOfferSummary(nft);
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
  const totalOffers = nftOfferCount(nft);
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
  refs.nftsPagePanel?.querySelectorAll("[data-refresh-nft-offers]").forEach((button) => {
    button.addEventListener("click", () => {
      const nftId = button.dataset.refreshNftOffers || "";
      const nft = getWalletState().snapshot?.nftItems?.find((item) => item.nftId === nftId);
      if (!nft) return;
      state.nftOfferCache.delete(nftId);
      button.textContent = "Refreshing...";
      void hydrateNftOffers([nft], true);
    });
  });
}

function renderNftViewer(nfts) {
  const selected = nfts.find((nft) => nft.nftId === state.selectedNftId) || nfts[0];
  state.selectedNftId = selected.nftId;
  const offers = nftOfferSummary(selected);
  const selectedHasOffers = (offers.sellOffers || 0) + (offers.buyOffers || 0) > 0;
  const totalSellOffers = nfts.reduce((sum, nft) => sum + (nftOfferSummary(nft).sellOffers || 0), 0);
  const totalBuyOffers = nfts.reduce((sum, nft) => sum + (nftOfferSummary(nft).buyOffers || 0), 0);
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
            <button class="ghost" type="button" data-refresh-nft-offers="${escapeHtml(selected.nftId)}">Refresh Offers</button>
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
  const offerNfts = nfts.filter((nft) => nftOfferCount(nft) > 0);

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
        ${offerNfts.slice(0, 12).map((nft) => {
          const offers = nftOfferSummary(nft);
          return `
          <div class="nft-listing-row" data-nft-id="${escapeHtml(nft.nftId)}">
            ${nftThumbMarkup(nft)}
            <div>
              <strong>${escapeHtml(nftDisplayName(nft))}</strong>
              <span>${escapeHtml(formatAddress(nft.nftId))}</span>
            </div>
            <div><span>Sell</span><strong>${offers.sellOffers || 0}</strong></div>
            <div><span>Buy</span><strong>${offers.buyOffers || 0}</strong></div>
          </div>
          `;
        }).join("")}
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
  if (state.activePage === "nfts" || state.activePage === "dashboard") {
    void hydrateNftOffers(nfts);
  }
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

function dexTokenKey(token = {}) {
  return watchKey([token.rawCurrency || token.currency, token.issuer]).toLowerCase();
}

function dexTokenOptions() {
  const seen = new Set();
  return [...state.dex.customTokens, ...state.topIssuedAssets.items].filter((token) => {
    const key = dexTokenKey(token);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 250);
}

function getDexSelectedToken() {
  const id = state.dex.selectedTokenId;
  if (!id) return null;
  return dexTokenOptions().find((t) => t.id === id) || null;
}

function getDexManualTokenFromInputs() {
  const currencyValue = refs.dexCurrencyInput?.value.trim() || state.dex.currency || "";
  const issuer = refs.dexIssuerInput?.value.trim() || state.dex.issuer || "";
  if (!currencyValue || !XRPL_ADDRESS_PATTERN.test(issuer)) return null;
  const rawCurrency = /^[A-Fa-f0-9]{40}$/.test(currencyValue)
    ? currencyValue
    : state.dex.rawCurrency || currencyValue;
  const currency = decodeCurrencyCode(currencyValue);
  return {
    id: watchKey([rawCurrency, issuer, "manual-chart"]),
    symbol: currency,
    currency,
    rawCurrency,
    issuer,
    source: "Manual XRPL asset",
    tags: ["manual"]
  };
}

function getDexChartToken() {
  return getDexSelectedToken() || getDexManualTokenFromInputs();
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

function mergeDexToken(token) {
  if (!token?.issuer || !(token.rawCurrency || token.currency)) return null;
  const normalized = {
    ...token,
    id: token.id || watchKey([token.rawCurrency || token.currency, token.issuer, "manual"]),
    symbol: token.symbol || token.currency || "Issued Asset",
    currency: decodeCurrencyCode(token.currency || token.rawCurrency || ""),
    rawCurrency: token.rawCurrency || token.currency,
    issuer: token.issuer
  };
  const key = dexTokenKey(normalized);
  const existing = dexTokenOptions().find((item) => dexTokenKey(item) === key);
  if (existing) return existing;
  state.dex.customTokens.unshift(normalized);
  state.dex.customTokens = state.dex.customTokens.slice(0, 25);
  populateDexAssetSelect();
  return normalized;
}

function applyDexToken(token) {
  if (!token) {
    state.dex.currency = "";
    state.dex.rawCurrency = "";
    state.dex.issuer = "";
    if (refs.dexCurrencyInput) refs.dexCurrencyInput.value = "";
    if (refs.dexIssuerInput) refs.dexIssuerInput.value = "";
    return;
  }
  state.dex.currency    = token.currency;                        // decoded (display)
  state.dex.rawCurrency = token.rawCurrency || token.currency;   // raw hex for XRPL protocol
  state.dex.issuer      = token.issuer;
  if (refs.dexCurrencyInput) refs.dexCurrencyInput.value = token.currency;
  if (refs.dexIssuerInput) refs.dexIssuerInput.value = token.issuer;
}

function selectNativeXrpDexChart() {
  state.dex.selectedTokenId = "";
  state.dex.currency = "";
  state.dex.rawCurrency = "";
  state.dex.issuer = "";
  state.dex.latestTx = null;
  state.dex.orderBook = { loading: false, error: "", bids: [], asks: [], updatedAt: 0 };
  if (refs.dexAssetSelect) refs.dexAssetSelect.value = "";
  if (refs.dexCurrencyInput) refs.dexCurrencyInput.value = "";
  if (refs.dexIssuerInput) refs.dexIssuerInput.value = "";
  setDexTicketStatus("Showing native XRP / USD chart. Select or enter an issued asset to build XRPL DEX offers.");
  renderDexStatsPanel();
  renderDexOrderBookPanel();
  renderDexTxPreview(null);
  renderDexInsightPanel();
  void loadDexChart(true);
}

function selectDexToken(token, options = {}) {
  const merged = mergeDexToken(token);
  if (!merged) return;
  state.dex.selectedTokenId = merged.id;
  applyDexToken(merged);
  if (refs.dexAssetSelect) refs.dexAssetSelect.value = merged.id;
  state.dex.latestTx = null;
  state.dex.orderBook = { loading: false, error: "", bids: [], asks: [], updatedAt: 0 };
  renderDexTxPreview(null);
  renderDexStatsPanel();
  renderDexOrderBookPanel();
  renderDexLookupResults();
  renderDexInsightPanel();
  if (options.status !== false) {
    setDexTicketStatus(`${merged.symbol || merged.currency} loaded. Refreshing chart and order book.`);
  }
  void loadDexChart(true);
  void loadDexOrderBook(true);
}

function walletDexTokenCandidates() {
  const walletState = getWalletState();
  return (walletState.snapshot?.tokenHoldings || []).map((token, index) => {
    const rawCurrency = token.currency || "";
    const currency = decodeCurrencyCode(rawCurrency);
    const issuer = token.counterparty || "";
    return {
      rank: index + 1,
      symbol: currency,
      currency,
      rawCurrency,
      issuer,
      id: watchKey([rawCurrency, issuer, "wallet"]),
      priceXrp: Number.NaN,
      priceUsd: Number.NaN,
      change24h: Number.NaN,
      marketCap: Number.NaN,
      holders: Number.NaN,
      trustlines: Number.NaN,
      volume24h: Number.NaN,
      verified: false,
      logoUrl: "",
      source: "Wallet trust line",
      tags: ["wallet"]
    };
  });
}

function allDexLookupCandidates() {
  const seen = new Set();
  return [...dexTokenOptions(), ...walletDexTokenCandidates()].filter((token) => {
    const key = dexTokenKey(token);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseManualDexTokenQuery(query) {
  const clean = String(query || "").trim();
  if (!clean || /^xrp$/i.test(clean)) return null;
  const parts = clean
    .replace(/[|,:/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return null;

  const issuer = parts.find((part) => XRPL_ADDRESS_PATTERN.test(part));
  const currency = parts.find((part) => part !== issuer && (/^[A-Za-z0-9]{3,20}$/.test(part) || /^[A-Fa-f0-9]{40}$/.test(part)));
  if (!issuer || !currency) return null;

  const decoded = decodeCurrencyCode(currency);
  return {
    id: watchKey([currency, issuer, "manual"]),
    symbol: decoded,
    currency: decoded,
    rawCurrency: currency,
    issuer,
    priceXrp: Number.NaN,
    priceUsd: Number.NaN,
    change24h: Number.NaN,
    marketCap: Number.NaN,
    holders: Number.NaN,
    trustlines: Number.NaN,
    volume24h: Number.NaN,
    verified: false,
    logoUrl: "",
    source: "Manual XRPL asset",
    tags: ["manual"]
  };
}

function tokenMatchesDexQuery(token, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const fields = [
    token.symbol,
    token.currency,
    token.rawCurrency,
    token.issuer,
    token.source,
    token.slug,
    ...(Array.isArray(token.tags) ? token.tags : [])
  ].map((value) => String(value || "").toLowerCase());
  return fields.some((value) => value.includes(q));
}

function dexLookupResultCard(result, index) {
  if (result.native) {
    return `
      <button class="dex-lookup-card is-native" type="button" data-dex-lookup-native="xrp">
        <span class="dex-lookup-rank">XRP</span>
        <span><strong>XRP / USD</strong><small>Native asset - chart only, no issuer</small></span>
        <span class="mode-pill">Native</span>
      </button>
    `;
  }

  const token = result.token || result;
  const risk = scoreIssuedAssetRisk(token);
  const price = Number.isFinite(token.priceXrp) ? `${escapeHtml(formatXrpAmount(token.priceXrp))} XRP` : "Price pending";
  return `
    <button class="dex-lookup-card" type="button" data-dex-lookup-index="${index}">
      ${tokenLogoMarkup(token, token.symbol || token.currency)}
      <span>
        <strong>${escapeHtml(token.symbol || token.currency || "Issued Asset")}</strong>
        <small>${escapeHtml(token.source || formatAddress(token.issuer))}</small>
      </span>
      <span class="dex-lookup-meta">
        <b>${price}</b>
        <em>${escapeHtml(risk.level)}</em>
      </span>
    </button>
  `;
}

function renderDexLookupResults() {
  if (!refs.dexLookupResults) return;
  if (state.dex.lookupLoading) {
    refs.dexLookupResults.innerHTML = `<p class="muted">Searching XRPL token sources...</p>`;
    return;
  }

  const results = state.dex.lookupResults || [];
  if (!results.length) {
    refs.dexLookupResults.innerHTML = state.dex.lookupStatus
      ? `<p class="muted">${escapeHtml(state.dex.lookupStatus)}</p>`
      : `<p class="muted">Search XRP, a ticker, issuer, or paste "currency issuer" to load any issued XRPL asset.</p>`;
    return;
  }

  refs.dexLookupResults.innerHTML = results.map((result, index) => dexLookupResultCard(result, index)).join("");
  refs.dexLookupResults.querySelectorAll("[data-dex-lookup-native]").forEach((button) => {
    button.addEventListener("click", selectNativeXrpDexChart);
  });
  refs.dexLookupResults.querySelectorAll("[data-dex-lookup-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const result = state.dex.lookupResults[Number(button.dataset.dexLookupIndex || "-1")];
      if (result?.token) selectDexToken(result.token);
    });
  });
}

async function fetchXrpScanDexLookup(query) {
  try {
    const data = await fetchMarketJson(XRPSCAN_TOKENS_URL);
    if (!Array.isArray(data)) return [];
    return data
      .map(normalizeXRPScanToken)
      .filter((token) => tokenMatchesDexQuery(token, query))
      .slice(0, 12);
  } catch {
    return [];
  }
}

async function onDexLookup() {
  const query = refs.dexLookupInput?.value.trim() || "";
  const lowered = query.toLowerCase();

  if (!query || lowered === "xrp" || lowered === "native") {
    state.dex.lookupResults = [
      { native: true },
      ...allDexLookupCandidates().slice(0, 8).map((token) => ({ token }))
    ];
    state.dex.lookupStatus = "";
    renderDexLookupResults();
    if (lowered === "xrp" || lowered === "native") selectNativeXrpDexChart();
    return;
  }

  state.dex.lookupLoading = true;
  state.dex.lookupStatus = "";
  renderDexLookupResults();

  const localMatches = allDexLookupCandidates()
    .filter((token) => tokenMatchesDexQuery(token, query))
    .slice(0, 14);
  const manual = parseManualDexTokenQuery(query);
  const xrpScanMatches = await fetchXrpScanDexLookup(query);

  const seen = new Set();
  const tokenResults = [
    ...(manual ? [manual] : []),
    ...localMatches,
    ...xrpScanMatches
  ].filter((token) => {
    const key = dexTokenKey(token);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);

  state.dex.lookupResults = tokenResults.map((token) => ({ token }));
  state.dex.lookupLoading = false;
  state.dex.lookupStatus = tokenResults.length
    ? ""
    : "No token found. Paste a currency and issuer address to load a custom XRPL asset.";
  renderDexLookupResults();
}

function syncDexStateFromInputs() {
  const typedCurrency = refs.dexCurrencyInput?.value.trim() || "";
  const typedIssuer = refs.dexIssuerInput?.value.trim() || "";
  const selectedToken = getDexSelectedToken();
  state.dex.currency = typedCurrency;
  state.dex.issuer = typedIssuer;
  if (/^[A-Fa-f0-9]{40}$/.test(typedCurrency)) {
    state.dex.rawCurrency = typedCurrency;
  } else if (selectedToken && selectedToken.currency === typedCurrency && selectedToken.issuer === typedIssuer) {
    state.dex.rawCurrency = selectedToken.rawCurrency || typedCurrency;
  } else {
    state.dex.rawCurrency = typedCurrency;
  }
  state.dex.amount = refs.dexAmountInput?.value || "";
  state.dex.price = refs.dexPriceInput?.value || "";
  state.dex.side = refs.dexSideSelect?.value || "buy";
  state.dex.orderStyle = refs.dexOrderStyleSelect?.value || "limit";
  state.dex.slippage = refs.dexSlippageInput?.value || "1";
  state.dex.stopLoss = refs.dexStopLossInput?.value || "";
  state.dex.takeProfit = refs.dexTakeProfitInput?.value || "";
}

function xrplAmountNumber(amount) {
  if (typeof amount === "string") return toFiniteNumber(amount, 0) / 1e6;
  if (amount && typeof amount === "object") return toFiniteNumber(amount.value, 0);
  return 0;
}

function normalizeDexBookOffer(offer, side) {
  const takerGets = xrplAmountNumber(offer.TakerGets);
  const takerPays = xrplAmountNumber(offer.TakerPays);
  const getsXrp = typeof offer.TakerGets === "string";
  const paysXrp = typeof offer.TakerPays === "string";
  const xrpAmount = getsXrp ? takerGets : paysXrp ? takerPays : 0;
  const tokenAmount = getsXrp ? takerPays : paysXrp ? takerGets : 0;
  const price = tokenAmount > 0 ? xrpAmount / tokenAmount : 0;
  const amount = tokenAmount;
  return { price, amount, raw: offer };
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
  const { side, orderStyle, currency, rawCurrency, issuer } = state.dex;
  if (!currency || !issuer) return null;
  const amount = toFiniteNumber(state.dex.amount, 0);
  const price = toFiniteNumber(state.dex.price, 0);
  if (amount <= 0 || price <= 0) return null;

  const xrplCurrency = rawCurrency || currency; // raw hex for XRPL protocol (non-3-char codes need hex)
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
    Flags: flags,
    Fee: "12"
  };

  if (side === "buy") {
    tx.TakerGets = xrpDrops;
    tx.TakerPays = { currency: xrplCurrency, issuer, value: issuedValue };
  } else {
    tx.TakerGets = { currency: xrplCurrency, issuer, value: issuedValue };
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

function renderDexTxPreview(preview, extraHtml = "") {
  const el = document.getElementById("txPreview");
  if (!el) return;
  if (!preview) {
    el.innerHTML = `<p class="muted">Fill the trade ticket and click Analyze Trade to see the transaction preview.</p>`;
    return;
  }
  el.innerHTML = `
    <div class="dex-preview-grid">
      <div class="dex-preview-row"><span class="dex-label">Direction</span><span class="chip chip-${preview.side === "BUY" ? "safe" : "medium"}">${preview.side}</span></div>
      <div class="dex-preview-row"><span class="dex-label">TakerGets</span><span>${escapeHtml(preview.takerGets)}</span></div>
      <div class="dex-preview-row"><span class="dex-label">TakerPays</span><span>${escapeHtml(preview.takerPays)}</span></div>
      <div class="dex-preview-row"><span class="dex-label">Order Style</span><span>${escapeHtml(preview.orderStyle)}</span></div>
      <div class="dex-preview-row"><span class="dex-label">Limit Price</span><span>${escapeHtml(preview.price)} XRP per token</span></div>
      <div class="dex-preview-row"><span class="dex-label">Slippage Guard</span><span>${escapeHtml(preview.slippage)}%</span></div>
      ${preview.stopLoss ? `<div class="dex-preview-row"><span class="dex-label">Stop Loss</span><span>${escapeHtml(preview.stopLoss)} XRP</span></div>` : ""}
      ${preview.takeProfit ? `<div class="dex-preview-row"><span class="dex-label">Take Profit</span><span>${escapeHtml(preview.takeProfit)} XRP</span></div>` : ""}
      <div class="dex-preview-row"><span class="dex-label">Account</span><span class="mono">${escapeHtml(preview.account || "-")}</span></div>
    </div>
    ${extraHtml}
  `;
}

function renderDexAccessPanel() {
  if (!refs.dexPagePanel) return;
  if (hasSigningWallet()) {
    const walletState = getWalletState();
    const providerKey = walletState.provider || sessionStorage.getItem("ike_wallet_provider");
    const provider = providerKey === "xaman" ? "Xumm/Xaman signer" : "Created wallet";
    refs.dexPagePanel.innerHTML = `
      <div class="dex-access-connected">
        <span class="chip chip-safe">Connected</span>
        <span class="muted">${escapeHtml(provider)} - ${escapeHtml(formatAddress(walletState.publicAddress || ""))}</span>
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

  const riskXrp = side === "buy"
    ? sl > 0 && sl < entry ? (entry - sl) * qty : 0
    : sl > entry ? (sl - entry) * qty : 0;
  const rewardXrp = side === "buy"
    ? tp > entry ? (tp - entry) * qty : 0
    : tp > 0 && tp < entry ? (entry - tp) * qty : 0;
  const rrRatio = riskXrp > 0 ? (rewardXrp / riskXrp).toFixed(2) : "—";
  const totalCost = entry * qty;
  const slipAmt = totalCost * (toFiniteNumber(slippage, 1) / 100);

  refs.dexRiskRewardPanel.innerHTML = `
    <div class="dex-stat"><span class="dex-label">Entry Price</span><span>${decimalString(entry, 6)} XRP</span></div>
    <div class="dex-stat"><span class="dex-label">Total Cost</span><span>${decimalString(totalCost, 4)} XRP</span></div>
    ${sl > 0 ? `<div class="dex-stat"><span class="dex-label">Risk (stop-loss)</span><span style="color:var(--color-error,#ef4444)">${decimalString(riskXrp, 4)} XRP</span></div>` : ""}
    ${tp > 0 ? `<div class="dex-stat"><span class="dex-label">Reward (take-profit)</span><span style="color:var(--color-success,#22c55e)">${decimalString(rewardXrp, 4)} XRP</span></div>` : ""}
    <div class="dex-stat"><span class="dex-label">R/R Ratio</span><span>${rrRatio}</span></div>
    <div class="dex-stat"><span class="dex-label">Slippage Allowance</span><span>${decimalString(slipAmt, 4)} XRP (${escapeHtml(slippage)}%)</span></div>
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

function chartVwap(candles = []) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const typical = (candle.h + candle.l + candle.c) / 3;
    const volume = candle.v > 0 ? candle.v : 1;
    cumulativePriceVolume += typical * volume;
    cumulativeVolume += volume;
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : NaN;
  });
}

function chartMacd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = chartEma(closes, fast);
  const slowEma = chartEma(closes, slow);
  const line = closes.map((_, i) =>
    Number.isFinite(fastEma[i]) && Number.isFinite(slowEma[i]) ? fastEma[i] - slowEma[i] : NaN
  );
  const signalLine = chartEma(line, signal);
  const histogram = line.map((value, i) =>
    Number.isFinite(value) && Number.isFinite(signalLine[i]) ? value - signalLine[i] : NaN
  );
  return { line, signal: signalLine, histogram };
}

function chartAtr(candles = [], n = 14) {
  const ranges = candles.map((candle, i) => {
    const prevClose = i > 0 ? candles[i - 1].c : candle.c;
    return Math.max(
      candle.h - candle.l,
      Math.abs(candle.h - prevClose),
      Math.abs(candle.l - prevClose)
    );
  });
  return chartSma(ranges, n);
}

function chartStoch(candles = [], n = 14) {
  return candles.map((candle, i) => {
    if (i < n - 1) return NaN;
    const window = candles.slice(i - n + 1, i + 1);
    const high = Math.max(...window.map((item) => item.h).filter(Number.isFinite));
    const low = Math.min(...window.map((item) => item.l).filter(Number.isFinite));
    if (!Number.isFinite(high) || !Number.isFinite(low) || high === low) return NaN;
    return ((candle.c - low) / (high - low)) * 100;
  });
}

function pctDistance(value, base) {
  return Number.isFinite(value) && Number.isFinite(base) && base !== 0
    ? ((value - base) / base) * 100
    : Number.NaN;
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

function xrplToOhlcParams(tf) {
  if (tf === "5M")  return { interval: "5m",  limit: 500, aggregateMs: 0 };
  if (tf === "15M") return { interval: "15m", limit: 500, aggregateMs: 0 };
  if (tf === "1H")  return { interval: "1h",  limit: 720, aggregateMs: 0 };
  if (tf === "4H")  return { interval: "4h",  limit: 500, aggregateMs: 0 };
  if (tf === "1W")  return { interval: "1d",  limit: 730, aggregateMs: 7 * 86_400_000 };
  return                   { interval: "1d",  limit: 730, aggregateMs: 0 };
}

function tokenXrplToMd5(token = {}) {
  const md5 = String(token.md5 || token._id || "").trim();
  if (/^[a-f0-9]{32}$/i.test(md5)) return md5;
  const id = String(token.id || "").trim();
  return /^[a-f0-9]{32}$/i.test(id) ? id : "";
}

async function resolveXrplToTokenMetadata(token = {}) {
  const existingMd5 = tokenXrplToMd5(token);
  if (existingMd5) return token;

  const issuer = String(token.issuer || "").trim();
  const rawCurrency = String(token.rawCurrency || token.currency || "").trim();
  if (!issuer || !rawCurrency) return token;

  const slug = token.slug || `${issuer}-${rawCurrency}`;
  try {
    const data = await fetchMarketJson(`https://api.xrpl.to/v1/token/${encodeURIComponent(slug)}`);
    const raw = data?.token || data;
    if (!raw?.md5) return token;
    const normalized = normalizeIssuedAssetMarketToken(raw);
    const key = dexTokenKey(normalized);
    const existing = state.dex.customTokens.findIndex((item) => dexTokenKey(item) === key);
    if (existing >= 0) state.dex.customTokens[existing] = { ...state.dex.customTokens[existing], ...normalized };
    else state.dex.customTokens.unshift(normalized);
    state.dex.customTokens = state.dex.customTokens.slice(0, 25);
    populateDexAssetSelect();
    if (state.dex.selectedTokenId === token.id) state.dex.selectedTokenId = normalized.id;
    return { ...token, ...normalized };
  } catch {
    return token;
  }
}

function normalizeOhlcRows(rows = []) {
  return rows
    .filter((row) => Array.isArray(row) && row.length >= 5)
    .map(([t, o, h, l, c, v = 0]) => ({
      t: Number(t) || 0,
      o: Number(o) || 0,
      h: Number(h) || 0,
      l: Number(l) || 0,
      c: Number(c) || 0,
      v: Number(v) || 0
    }))
    .filter((candle) => candle.t > 0 && candle.c > 0 && candle.h > 0 && candle.l > 0)
    .sort((a, b) => a.t - b.t);
}

function aggregateCandles(candles = [], bucketMs = 0) {
  if (!bucketMs || candles.length <= 1) return candles;
  const buckets = new Map();
  candles.forEach((candle) => {
    const bucket = Math.floor(candle.t / bucketMs) * bucketMs;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { t: bucket, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: candle.v });
      return;
    }
    current.h = Math.max(current.h, candle.h);
    current.l = Math.min(current.l, candle.l);
    current.c = candle.c;
    current.v += candle.v || 0;
  });
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

async function fetchXrplToOhlc(token, tf) {
  const resolvedToken = await resolveXrplToTokenMetadata(token);
  const md5 = tokenXrplToMd5(resolvedToken);
  if (!md5) return [];
  const { interval, limit, aggregateMs } = xrplToOhlcParams(tf);
  const url = `${XRPL_TO_OHLC_BASE_URL}/${encodeURIComponent(md5)}?interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const data = await fetchMarketJson(url);
  const rows = Array.isArray(data?.ohlc) ? data.ohlc : Array.isArray(data) ? data : [];
  return aggregateCandles(normalizeOhlcRows(rows), aggregateMs);
}

function tradeAssetValue(asset = {}) {
  return toFiniteNumber(asset.value ?? asset.amount, Number.NaN);
}

function tradeAssetIsXrp(asset = {}) {
  return String(asset.currency || "").toUpperCase() === "XRP";
}

function tradeAssetMatchesToken(asset = {}, token = {}) {
  const assetCurrency = String(asset.currency || "").trim();
  const tokenRaw = String(token.rawCurrency || token.currency || "").trim();
  const tokenDecoded = decodeCurrencyCode(tokenRaw);
  return String(asset.issuer || "") === String(token.issuer || "")
    && (assetCurrency === tokenRaw || decodeCurrencyCode(assetCurrency) === tokenDecoded);
}

function historyTradeToPoint(trade = {}, token = {}) {
  const paid = trade.paid || {};
  const got = trade.got || {};
  const time = toFiniteNumber(trade.time, 0);
  if (!time) return null;

  let price = Number.NaN;
  let tokenVolume = Number.NaN;
  if (tradeAssetMatchesToken(got, token) && tradeAssetIsXrp(paid)) {
    const xrp = tradeAssetValue(paid);
    const tok = tradeAssetValue(got);
    if (xrp > 0 && tok > 0) {
      price = xrp / tok;
      tokenVolume = tok;
    }
  } else if (tradeAssetMatchesToken(paid, token) && tradeAssetIsXrp(got)) {
    const xrp = tradeAssetValue(got);
    const tok = tradeAssetValue(paid);
    if (xrp > 0 && tok > 0) {
      price = xrp / tok;
      tokenVolume = tok;
    }
  }
  if (!Number.isFinite(price) || price <= 0) return null;
  return { t: time, price, volume: Number.isFinite(tokenVolume) ? tokenVolume : 0 };
}

function tradePointsToCandles(points = [], tf = "1D") {
  const bucketMs = tf === "5M" ? 5 * 60_000
    : tf === "15M" ? 15 * 60_000
    : tf === "1H" ? 60 * 60_000
    : tf === "4H" ? 4 * 60 * 60_000
    : tf === "1W" ? 7 * 86_400_000
    : 86_400_000;
  const buckets = new Map();
  points.sort((a, b) => a.t - b.t).forEach((point) => {
    const bucket = Math.floor(point.t / bucketMs) * bucketMs;
    const candle = buckets.get(bucket);
    if (!candle) {
      buckets.set(bucket, { t: bucket, o: point.price, h: point.price, l: point.price, c: point.price, v: point.volume || 0 });
      return;
    }
    candle.h = Math.max(candle.h, point.price);
    candle.l = Math.min(candle.l, point.price);
    candle.c = point.price;
    candle.v += point.volume || 0;
  });
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

async function fetchXrplToHistoryCandles(token, tf) {
  const resolvedToken = await resolveXrplToTokenMetadata(token);
  const md5 = tokenXrplToMd5(resolvedToken);
  if (!md5) return [];
  const url = `${XRPL_TO_HISTORY_BASE_URL}?md5=${encodeURIComponent(md5)}&limit=500`;
  const data = await fetchMarketJson(url);
  const trades = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const points = trades.map((trade) => historyTradeToPoint(trade, token)).filter(Boolean);
  return tradePointsToCandles(points, tf);
}

// ── Sologenic DEX OHLCV helpers ──────────────────────────────────

function sologenicPeriod(tf) {
  if (tf === "5M" || tf === "15M") return "5m";
  if (tf === "1H" || tf === "4H") return "1h";
  return "1d"; // 1D, 1W
}

function sologenicFromTs(tf) {
  const now = Math.floor(Date.now() / 1000);
  if (tf === "5M")  return now - 6   * 3600;
  if (tf === "15M") return now - 24  * 3600;
  if (tf === "1H")  return now - 7   * 86400;
  if (tf === "4H")  return now - 30  * 86400;
  if (tf === "1W")  return now - 365 * 86400;
  return              now - 90  * 86400; // 1D
}

async function fetchSologenicOhlcv(token, tf) {
  const { rawCurrency, issuer } = token;
  if (!rawCurrency || !issuer) return [];
  const period = sologenicPeriod(tf);
  const from   = sologenicFromTs(tf);
  const to     = Math.floor(Date.now() / 1000);
  const symbol = encodeURIComponent(`${rawCurrency}+${issuer}/XRP`);
  const url    = `https://api.sologenic.org/api/v1/ohlc?symbol=${symbol}&period=${period}&from=${from}&to=${to}`;
  const raw    = await fetchMarketJson(url);
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .filter(c => Array.isArray(c) && c.length >= 5)
    .map(([ts, o, h, l, c, v = 0]) => ({
      t: ts * 1000,
      o: +o || 0, h: +h || 0, l: +l || 0, c: +c || 0, v: +v || 0
    }))
    .filter(c => c.c > 0);
}

async function fetchDexChartData(token, tf = "1D") {
  const { krakenInterval, limit } = dexTfParams(tf);

  if (!token) {
    // XRP/USD — Kraken public API (CORS-friendly, XRP is native so not on xrpl.to)
    const candles = await fetchKrakenXrpOhlcv(krakenInterval, limit);
    if (!candles.length) throw new Error("No XRP/USD data from Kraken.");
    return { candles, label: `XRP / USD — ${tf} · Kraken`, source: "Kraken XRP/USD" };
  }

  const { symbol, currency } = token;
  const chartLabel = `${symbol || currency} / XRP — ${tf}`;

  // Source 1 — XRPL.to indexed OHLCV by token md5. This is the broadest XRPL-native chart source.
  try {
    const candles = await fetchXrplToOhlc(token, tf);
    if (candles.length) return { candles, label: `${chartLabel} · XRPL.to OHLC`, source: "XRPL.to OHLC" };
  } catch { /* fall through */ }

  // Source 2 — XRPL.to trade history, aggregated locally into candles.
  try {
    const candles = await fetchXrplToHistoryCandles(token, tf);
    if (candles.length) return { candles, label: `${chartLabel} · XRPL.to trades`, source: "XRPL.to history" };
  } catch { /* fall through */ }

  // Source 3 — Sologenic DEX OHLCV (XRPL-native prices in XRP)
  try {
    const candles = await fetchSologenicOhlcv(token, tf);
    if (candles.length) return { candles, label: `${chartLabel} · Sologenic`, source: "Sologenic OHLC" };
  } catch { /* fall through */ }

  // Source 4 — CoinGecko OHLCV, converted from USD to XRP using Kraken XRP/USD history
  const cgSymbol = symbol || currency;
  if (cgSymbol) {
    try {
      const cgId = await fetchCoinGeckoId(cgSymbol);
      if (cgId) {
        // Map tf → CoinGecko days (granularity: 1=30min, 14=4h, 90=daily, 365=weekly)
        const cgDays = tf === "5M" || tf === "15M" || tf === "1H" ? 1
          : tf === "4H" ? 14
          : tf === "1W" ? 365
          : 90;
        const cgRaw = await fetchMarketJson(
          `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${cgDays}`
        );
        if (Array.isArray(cgRaw) && cgRaw.length) {
          const usdCandles = cgRaw
            .map(([t, o, h, l, c]) => ({ t: +t || 0, o: +o || 0, h: +h || 0, l: +l || 0, c: +c || 0, v: 0 }))
            .filter(c => c.c > 0);
          if (usdCandles.length) {
            try {
              const xrpCandles = await fetchKrakenXrpOhlcv(krakenInterval, usdCandles.length + 10);
              if (xrpCandles.length) {
                const sorted = xrpCandles.slice().sort((a, b) => a.t - b.t);
                const closestXrpPrice = (tMs) => {
                  let lo = 0, hi = sorted.length - 1, best = sorted[0].c;
                  while (lo <= hi) {
                    const mid = (lo + hi) >> 1;
                    if (sorted[mid].t <= tMs) { best = sorted[mid].c; lo = mid + 1; }
                    else hi = mid - 1;
                  }
                  return best;
                };
                const converted = usdCandles.map(c => {
                  const xrp = closestXrpPrice(c.t);
                  if (!xrp || xrp <= 0) return null;
                  return { t: c.t, o: c.o / xrp, h: c.h / xrp, l: c.l / xrp, c: c.c / xrp, v: c.v };
                }).filter(Boolean);
                if (converted.length) return { candles: converted, label: `${chartLabel} · CoinGecko converted`, source: "CoinGecko + Kraken" };
              }
            } catch { /* fall through: show USD */ }
            return {
              candles: usdCandles,
              label: `${symbol || currency} / USD — ${tf} · CoinGecko`,
              source: "CoinGecko USD"
            };
          }
        }
      }
    } catch { /* try live price fallback */ }
  }

  // Source 5 — XRPL ledger live price via amm_info + book_offers (no OHLCV history)
  const livePrice = await fetchTokenSpotFromXrpl(token);
  if (livePrice > 0) {
    const now = Date.now();
    return {
      candles: [{ t: now, o: livePrice, h: livePrice, l: livePrice, c: livePrice, v: 0 }],
      label: `${chartLabel} · live only`,
      source: "XRPL spot"
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
  const token = getDexChartToken();
  const tokenId = token?.id || "";
  const tf = state.dex.chart.timeframe;
  const cacheKey = `${tokenId}:${tf}`;

  if (
    !force
    && state.dex.chart.cacheKey === cacheKey
    && state.dex.chart.fetchedAt
    && Date.now() - state.dex.chart.fetchedAt < 5 * 60 * 1000
  ) {
    renderDexInsightPanel();
    return;
  }

  const myId = ++_dexChartLoadId;
  state.dex.chart.loading = true;
  state.dex.chart.error = "";
  state.dex.chart.source = "";
  state.dex.chart.cacheKey = cacheKey;
  state.dex.chart.tokenId = tokenId;
  drawDexAnalysisChart();

  try {
    const { candles, label, source = "" } = await fetchDexChartData(token, tf);
    if (myId !== _dexChartLoadId) return; // superseded by a newer selection
    state.dex.chart = {
      ...state.dex.chart,
      candles,
      label,
      source,
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
    state.dex.chart.source = "";
  }

  drawDexAnalysisChart();
  renderDexInsightPanel();
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
      ${[["ma20","MA 20"],["ma50","MA 50"],["ema20","EMA 20"],["vwap","VWAP"],["bb","BB"],["volume","Vol"],["rsi","RSI"],["macd","MACD"]].map(([k,l]) =>
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
      ...allDexLookupCandidates()
        .filter((t) => !q || t.name?.toLowerCase().includes(q) || t.symbol?.toLowerCase().includes(q) || t.currency?.toLowerCase().includes(q))
        .slice(0, 30)
        .map((t) => ({ id: t.id || t.md5 || "", label: `${t.symbol || t.currency} / XRP`, sub: t.name || t.issuer || "" }))
    ];
    assetList.innerHTML = items.map((it) =>
      `<div class="dex-asset-item${it.id === (state.dex.selectedTokenId || "") ? " is-active" : ""}" data-id="${escapeHtml(it.id)}">
        <span class="dex-asset-item-label">${escapeHtml(it.label)}</span>
        <span class="dex-asset-item-sub">${escapeHtml(it.sub)}</span>
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
      state.dex.rawCurrency = "";
      if (refs.dexAssetSelect) refs.dexAssetSelect.value = "";
      if (refs.dexCurrencyInput) refs.dexCurrencyInput.value = "";
      if (refs.dexIssuerInput) refs.dexIssuerInput.value = "";
    } else {
      const tok = allDexLookupCandidates().find((t) => (t.id || t.md5 || "") === id);
      if (tok) {
        assetBtn.textContent = `${tok.symbol || tok.currency} / XRP ▾`;
        if (refs.dexAssetSelect) refs.dexAssetSelect.value = tok.id || "";
        applyDexToken(tok);
        void loadDexOrderBook(true);
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
      const delta   = Math.round(dxPx * barsPerPx);
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
      const delta  = Math.round(dxPx * (dexChartBarsVis / plotPx));
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
  const { volume, rsi, macd } = state.dex.chart.indicators;
  const INFO = 36;   // top OHLCV info bar
  const MAIN = 380;  // main price area
  const SUB  = 80;   // volume / RSI sub-panel height
  const XBAR = 24;   // bottom time axis
  const LP   = 4;    // left margin (tiny — axis is on right)
  const RP   = 72;   // right price axis width

  const dpr   = window.devicePixelRatio || 1;
  const W     = Math.max((canvas.parentElement?.clientWidth || 900), 300);
  const H     = INFO + MAIN + (volume ? SUB : 0) + (rsi ? SUB : 0) + (macd ? SUB : 0) + XBAR;
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
  const macdTop    = rsi ? rsiBottom : (volume ? volBottom : mainBottom);
  const macdBottom = macdTop + (macd ? SUB : 0);
  const xTop       = macd ? macdBottom : rsi ? rsiBottom : (volume ? volBottom : mainBottom);
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
    vwap:     "#4dd0e1",
    bb:       "#9966cc",
    rsiLine:  "#c084fc",
    macdLine: "#42a5f5",
    macdSignal: "#ffb74d",
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
  const vwapv   = inds.vwap  ? chartVwap(candles)     : [];
  const bbv     = inds.bb    ? chartBB(closes, 20, 2) : [];
  const rsiVals = inds.rsi   ? chartRsi(closes, 14)   : [];
  const macdVals = inds.macd ? chartMacd(closes)       : { line: [], signal: [], histogram: [] };

  const allP = [
    ...candles.map((c) => c.h), ...candles.map((c) => c.l),
    ...(inds.ma20  ? ma20v.filter(Number.isFinite)                              : []),
    ...(inds.ma50  ? ma50v.filter(Number.isFinite)                              : []),
    ...(inds.ema20 ? ema20v.filter(Number.isFinite)                             : []),
    ...(inds.vwap  ? vwapv.filter(Number.isFinite)                              : []),
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
  if (inds.vwap  && vwapv.length)  drawLine(vwapv,  C.vwap);

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
  if (volume) { ctx.beginPath(); ctx.moveTo(plotL, volBottom); ctx.lineTo(W, volBottom); ctx.stroke(); }
  if (rsi) { ctx.beginPath(); ctx.moveTo(plotL, rsiBottom); ctx.lineTo(W, rsiBottom); ctx.stroke(); }
  if (macd) { ctx.beginPath(); ctx.moveTo(plotL, macdBottom); ctx.lineTo(W, macdBottom); ctx.stroke(); }
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

  // ── MACD panel ───────────────────────────────────────────────
  if (macd && macdVals.line.length) {
    const values = [...macdVals.line, ...macdVals.signal, ...macdVals.histogram].filter(Number.isFinite);
    const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0.000001);
    const yZero = macdTop + SUB / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.moveTo(plotL, yZero); ctx.lineTo(plotR, yZero); ctx.stroke();
    macdVals.histogram.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      const x = toX(i);
      const y = subToY(value, macdTop + 5, macdBottom - 5, -maxAbs, maxAbs);
      ctx.fillStyle = value >= 0 ? C.volUp : C.volDown;
      ctx.fillRect(x - bodyW / 2, Math.min(y, yZero), bodyW, Math.max(Math.abs(yZero - y), 1));
    });
    const drawSubLine = (vals, color) => {
      const p = new Path2D(); let s = false;
      vals.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = toX(i), y = subToY(v, macdTop + 5, macdBottom - 5, -maxAbs, maxAbs);
        if (!s) { p.moveTo(x, y); s = true; } else p.lineTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke(p);
    };
    drawSubLine(macdVals.line, C.macdLine);
    drawSubLine(macdVals.signal, C.macdSignal);
    ctx.fillStyle = C.axisText; ctx.font = "9px system-ui"; ctx.textAlign = "left";
    ctx.fillText("MACD", plotL + 4, macdTop + 12);
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
  if (inds.vwap)  { ctx.fillStyle = C.vwap;  ctx.fillText("VWAP",   lx, ly); lx += 38; }
  if (inds.bb)    { ctx.fillStyle = C.bb;    ctx.fillText("BB(20)", lx, ly); }

  // ── Crosshair ────────────────────────────────────────────────
  const fullBottom = macd ? macdBottom : rsi ? rsiBottom : (volume ? volBottom : mainBottom);
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

  const safeCurrency = escapeHtml(currency);
  const steps = [
    `<strong>Step 1:</strong> Place ${side === "buy" ? "BUY" : "SELL"} OfferCreate for ${decimalString(qty, 4)} ${safeCurrency} at ${decimalString(entry, 6)} XRP/token via Xumm.`,
    `<strong>Step 2:</strong> Monitor XRPL ledger for offer fill status.`,
    sl > 0 ? `<strong>Step 3 (Stop-Loss):</strong> If price ${side === "buy" ? "drops to" : "rises to"} ${decimalString(sl, 6)} XRP, manually place a ${side === "buy" ? "SELL" : "BUY"} offer to exit.` : null,
    tp > 0 ? `<strong>Step ${sl > 0 ? 4 : 3} (Take-Profit):</strong> If price ${side === "buy" ? "reaches" : "falls to"} ${decimalString(tp, 6)} XRP, manually place a ${side === "buy" ? "SELL" : "BUY"} offer to lock in gains.` : null
  ].filter(Boolean);

  refs.dexExecutionPlanPanel.innerHTML = steps.map((s) => `<p>${s}</p>`).join("");
}

function renderDexSafetyPanel() {
  if (!refs.dexSafetyPanel) return;
  const { currency, issuer, slippage, orderStyle, side, price, stopLoss, takeProfit } = state.dex;
  const warnings = [];
  const entry = toFiniteNumber(price, 0);
  const sl = toFiniteNumber(stopLoss, 0);
  const tp = toFiniteNumber(takeProfit, 0);

  if (!issuer) warnings.push("No issuer set. Verify the token issuer before creating any offer.");
  if (toFiniteNumber(slippage, 0) > 5) warnings.push(`Slippage guard is ${slippage}% - high slippage increases fill risk at unfavorable prices.`);
  if (orderStyle === "fok" || orderStyle === "ioc") warnings.push(`${orderStyle.toUpperCase()} orders may not fill if liquidity is insufficient and will be cancelled automatically.`);
  if (currency && currency.length === 40) warnings.push("Currency uses a 40-char hex code — confirm you recognize this issuer address.");
  if (entry > 0 && sl > 0 && side === "buy" && sl >= entry) warnings.push("For a long/buy plan, stop loss should usually be below entry.");
  if (entry > 0 && tp > 0 && side === "buy" && tp <= entry) warnings.push("For a long/buy plan, take profit should usually be above entry.");
  if (entry > 0 && sl > 0 && side === "sell" && sl <= entry) warnings.push("For a sell/short-style plan, stop loss should usually be above entry.");
  if (entry > 0 && tp > 0 && side === "sell" && tp >= entry) warnings.push("For a sell/short-style plan, take profit should usually be below entry.");
  warnings.push("XRPL does not provide native stop-loss automation. Stop and take-profit levels are planning guides only.");
  warnings.push("All transactions are irreversible once validated on-ledger. Verify every field in Xumm before approving.");

  refs.dexSafetyPanel.innerHTML = warnings.map((w) => `<p class="warning-inline">&#x26A0; ${escapeHtml(w)}</p>`).join("");
}

function latestFinite(values = []) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return Number.NaN;
}

function dexChartAnalysisModel() {
  const candles = state.dex.chart.candles || [];
  const stats = dexOrderStats();
  const token = getDexChartToken();
  const last = candles.at(-1);
  const first = candles[0];
  const closes = candles.map((candle) => candle.c);
  const current = last?.c || stats?.midPrice || toFiniteNumber(state.dex.price, Number.NaN);
  const change = first?.c > 0 && last?.c > 0 ? ((last.c - first.c) / first.c) * 100 : Number.NaN;
  const high = candles.length ? Math.max(...candles.map((candle) => candle.h).filter(Number.isFinite)) : Number.NaN;
  const low = candles.length ? Math.min(...candles.map((candle) => candle.l).filter(Number.isFinite)) : Number.NaN;
  const avgVolume = candles.length
    ? candles.reduce((sum, candle) => sum + toFiniteNumber(candle.v, 0), 0) / candles.length
    : Number.NaN;
  const volatility = Number.isFinite(high) && Number.isFinite(low) && current > 0 ? ((high - low) / current) * 100 : Number.NaN;
  const ma20Series = chartSma(closes, 20);
  const ma50Series = chartSma(closes, 50);
  const ma20 = latestFinite(ma20Series);
  const ma50 = latestFinite(ma50Series);
  const rsi = latestFinite(chartRsi(closes, 14));
  const macd = chartMacd(closes);
  const macdLine = latestFinite(macd.line);
  const macdSignal = latestFinite(macd.signal);
  const macdHist = latestFinite(macd.histogram);
  const atr = latestFinite(chartAtr(candles, 14));
  const atrPct = current > 0 ? (atr / current) * 100 : Number.NaN;
  const stoch = latestFinite(chartStoch(candles, 14));
  const vwap = latestFinite(chartVwap(candles));
  const bb = chartBB(closes, 20, 2);
  const lastBb = bb.slice().reverse().find((item) => Number.isFinite(item.upper) && Number.isFinite(item.lower)) || {};
  const recent = candles.slice(-Math.min(50, candles.length));
  const support = recent.length ? Math.min(...recent.map((candle) => candle.l).filter(Number.isFinite)) : Number.NaN;
  const resistance = recent.length ? Math.max(...recent.map((candle) => candle.h).filter(Number.isFinite)) : Number.NaN;
  const last20 = candles.slice(-20);
  const prev20 = candles.slice(-40, -20);
  const avg = (items) => items.length ? items.reduce((sum, candle) => sum + toFiniteNumber(candle.v, 0), 0) / items.length : Number.NaN;
  const recentVolume = avg(last20);
  const priorVolume = avg(prev20);
  const volumeShift = Number.isFinite(recentVolume) && Number.isFinite(priorVolume) && priorVolume > 0
    ? ((recentVolume - priorVolume) / priorVolume) * 100
    : Number.NaN;
  const ma20Prev = ma20Series.slice(0, -5).reverse().find(Number.isFinite);
  const ma20Slope = pctDistance(ma20, ma20Prev);
  const source = state.dex.chart.source || (candles.length ? "Unknown source" : "");
  const dataQuality = !candles.length ? "No chart history"
    : candles.length < 2 ? "Spot only"
    : candles.length < 20 ? "Thin history"
    : source.includes("XRPL.to") ? "Indexed XRPL history"
    : source.includes("CoinGecko") ? "External market proxy"
    : "Usable history";
  const risk = token ? scoreIssuedAssetRisk(token) : { level: "Native XRP", reasons: ["Native asset"] };
  const bullishVotes = [
    Number.isFinite(ma20) && current > ma20,
    Number.isFinite(ma50) && current > ma50,
    Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 > ma50,
    Number.isFinite(macdHist) && macdHist > 0,
    Number.isFinite(rsi) && rsi > 50 && rsi < 72,
    Number.isFinite(vwap) && current > vwap
  ].filter(Boolean).length;
  const bearishVotes = [
    Number.isFinite(ma20) && current < ma20,
    Number.isFinite(ma50) && current < ma50,
    Number.isFinite(ma20) && Number.isFinite(ma50) && ma20 < ma50,
    Number.isFinite(macdHist) && macdHist < 0,
    Number.isFinite(rsi) && rsi < 50 && rsi > 28,
    Number.isFinite(vwap) && current < vwap
  ].filter(Boolean).length;
  const bias = bullishVotes >= bearishVotes + 2 ? "Bullish bias"
    : bearishVotes >= bullishVotes + 2 ? "Bearish bias"
    : "Mixed / range bias";

  return {
    token,
    stats,
    candles,
    current,
    change,
    high,
    low,
    avgVolume,
    volatility,
    ma20,
    ma50,
    ma20Slope,
    rsi,
    macdLine,
    macdSignal,
    macdHist,
    atr,
    atrPct,
    stoch,
    vwap,
    bb: lastBb,
    support,
    resistance,
    recentVolume,
    volumeShift,
    source,
    dataQuality,
    bullishVotes,
    bearishVotes,
    bias,
    risk
  };
}

function renderDexInsightPanel() {
  if (!refs.dexInsightPanel) return;
  const model = dexChartAnalysisModel();
  const {
    token,
    stats,
    candles,
    current,
    change,
    volatility,
    ma20,
    ma50,
    ma20Slope,
    rsi,
    macdLine,
    macdSignal,
    macdHist,
    atrPct,
    stoch,
    vwap,
    bb,
    support,
    resistance,
    volumeShift,
    source,
    dataQuality,
    bullishVotes,
    bearishVotes,
    bias,
    risk
  } = model;
  const entry = toFiniteNumber(state.dex.price, 0);
  const amount = toFiniteNumber(state.dex.amount, 0);
  const slippage = toFiniteNumber(state.dex.slippage, 0);
  const rrEntry = entry || current;
  const stop = toFiniteNumber(state.dex.stopLoss, 0);
  const target = toFiniteNumber(state.dex.takeProfit, 0);
  const side = state.dex.side;
  const trend = Number.isFinite(ma20) && Number.isFinite(ma50)
    ? ma20 > ma50 ? "Bullish MA stack" : ma20 < ma50 ? "Bearish MA stack" : "Neutral MA stack"
    : "Trend pending";
  const momentum = Number.isFinite(rsi)
    ? rsi >= 70 ? "RSI overheated" : rsi <= 30 ? "RSI washed out" : "RSI balanced"
    : "RSI pending";
  const macdPosture = Number.isFinite(macdLine) && Number.isFinite(macdSignal)
    ? macdLine > macdSignal ? `MACD positive ${Number.isFinite(macdHist) ? `(${decimalString(macdHist, 6)})` : ""}` : `MACD negative ${Number.isFinite(macdHist) ? `(${decimalString(macdHist, 6)})` : ""}`
    : "MACD pending";
  const vwapPosture = Number.isFinite(vwap) && Number.isFinite(current)
    ? current > vwap ? `Above VWAP by ${decimalString(pctDistance(current, vwap), 2)}%` : `Below VWAP by ${decimalString(Math.abs(pctDistance(current, vwap)), 2)}%`
    : "VWAP pending";
  const bbPosture = Number.isFinite(bb.upper) && Number.isFinite(bb.lower) && Number.isFinite(current)
    ? current > bb.upper ? "Above upper band" : current < bb.lower ? "Below lower band" : "Inside bands"
    : "Bands pending";
  const stochPosture = Number.isFinite(stoch)
    ? stoch >= 80 ? `Stoch overbought ${stoch.toFixed(0)}` : stoch <= 20 ? `Stoch oversold ${stoch.toFixed(0)}` : `Stoch neutral ${stoch.toFixed(0)}`
    : "Stoch pending";
  const spreadText = stats
    ? `${decimalString(stats.spreadPct, 2)}% spread`
    : "Book pending";
  const riskXrp = rrEntry && amount
    ? side === "buy"
      ? stop > 0 && stop < rrEntry ? (rrEntry - stop) * amount : 0
      : stop > rrEntry ? (stop - rrEntry) * amount : 0
    : 0;
  const rewardXrp = rrEntry && amount
    ? side === "buy"
      ? target > rrEntry ? (target - rrEntry) * amount : 0
      : target > 0 && target < rrEntry ? (rrEntry - target) * amount : 0
    : 0;
  const rrRatio = riskXrp > 0 ? rewardXrp / riskXrp : Number.NaN;
  const flags = [];

  if (token && !token.verified) flags.push("Issuer is not marked verified in available token metadata.");
  if (token?.freezeFlag) flags.push("Issuer may have freeze capability. Understand what that means before holding size.");
  if (!candles.length) flags.push("Historical chart data is not available yet for this market.");
  if (candles.length === 1) flags.push("Only live spot data is available; avoid reading this as a trend.");
  if (candles.length > 1 && candles.length < 20) flags.push("Short candle history. Signals are low-confidence until more trades load.");
  if (source.includes("CoinGecko")) flags.push("Chart source is external market data, not native XRPL DEX execution history.");
  if (stats?.spreadPct > 5) flags.push("Wide spread detected. Market orders or IOC/FOK offers can fill poorly.");
  if (stats && (stats.bidDepth < amount || stats.askDepth < amount)) flags.push("Visible book depth is thinner than the planned amount.");
  if (slippage > 5) flags.push("Slippage guard is high.");
  if (Number.isFinite(rsi) && (rsi >= 75 || rsi <= 25)) flags.push("Momentum is stretched; entries can reverse quickly.");
  if (Number.isFinite(stoch) && (stoch >= 90 || stoch <= 10)) flags.push("Stochastic is at an extreme. Watch for wick reversals or failed breakouts.");
  if (Number.isFinite(atrPct) && atrPct > 8) flags.push("ATR is high relative to price. Position sizing should account for volatility.");
  if (Number.isFinite(bb.upper) && Number.isFinite(current) && (current > bb.upper || current < bb.lower)) flags.push("Price is outside Bollinger Bands. Confirm continuation before chasing.");
  if (rrEntry && stop && target && !Number.isFinite(rrRatio)) flags.push("Stop and target do not form a usable risk/reward setup.");

  const stat = (label, value, tone = "") => `
    <div class="dex-insight-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
  const row = (label, value, tone = "") => `
    <div class="dex-analysis-row ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `;
  const priceUnit = token ? "XRP" : "USD";
  const priceText = (value, decimals = 6) => Number.isFinite(value)
    ? `${decimalString(value, value < 0.01 ? 8 : decimals)} ${priceUnit}`
    : "-";
  const voteTone = bullishVotes > bearishVotes ? "safe" : bearishVotes > bullishVotes ? "danger" : "";
  const moveTone = Number.isFinite(change) && change < 0 ? "danger" : Number.isFinite(change) && change > 0 ? "safe" : "";
  const dataTone = dataQuality === "Indexed XRPL history" ? "safe"
    : dataQuality === "No chart history" || dataQuality === "Spot only" ? "danger"
    : "";

  refs.dexInsightPanel.innerHTML = `
    <div class="dex-insight-header">
      <div>
        <h4>Technical Market Intelligence</h4>
        <p class="muted">${escapeHtml(token ? `${token.symbol || token.currency} / XRP` : "XRP / USD")} analysis from indexed candles, live book depth, and the trade ticket.</p>
      </div>
      <span class="mode-pill">${escapeHtml(risk.level)}</span>
    </div>
    <div class="dex-insight-grid">
      ${stat("Last / Mid", priceText(current))}
      ${stat("Chart Move", Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "-", moveTone)}
      ${stat("Data Source", escapeHtml(source || dataQuality), dataTone)}
      ${stat("Directional Bias", `${escapeHtml(bias)} (${bullishVotes}/${bearishVotes})`, voteTone)}
      ${stat("ATR / Volatility", Number.isFinite(atrPct) ? `${atrPct.toFixed(2)}% ATR · ${Number.isFinite(volatility) ? `${volatility.toFixed(2)}% range` : "range n/a"}` : Number.isFinite(volatility) ? `${volatility.toFixed(2)}% range` : "-")}
      ${stat("Liquidity", spreadText, stats?.spreadPct > 5 ? "danger" : "safe")}
      ${stat("Trend", trend)}
      ${stat("Momentum", momentum)}
      ${stat("MACD", macdPosture)}
      ${stat("VWAP", vwapPosture)}
      ${stat("Bollinger", bbPosture)}
      ${stat("Stochastic", stochPosture)}
      ${stat("Support", priceText(support))}
      ${stat("Resistance", priceText(resistance))}
      ${stat("Volume Shift", Number.isFinite(volumeShift) ? `${volumeShift >= 0 ? "+" : ""}${volumeShift.toFixed(1)}% vs prior 20` : "Volume pending", Number.isFinite(volumeShift) && volumeShift > 25 ? "safe" : Number.isFinite(volumeShift) && volumeShift < -25 ? "danger" : "")}
      ${stat("MA Slope", Number.isFinite(ma20Slope) ? `${ma20Slope >= 0 ? "+" : ""}${ma20Slope.toFixed(2)}%` : "Pending")}
      ${stat("Risk / Reward", Number.isFinite(rrRatio) ? `${rrRatio.toFixed(2)}R` : "Plan pending", Number.isFinite(rrRatio) && rrRatio >= 2 ? "safe" : Number.isFinite(rrRatio) && rrRatio < 1 ? "danger" : "")}
    </div>
    <div class="dex-analysis-list">
      ${row("Chart coverage", `${escapeHtml(dataQuality)} · ${candles.length} candle${candles.length === 1 ? "" : "s"}`, dataTone)}
      ${row("Execution read", stats ? `Bid depth ${formatCompactNumber(stats.bidDepth)} · Ask depth ${formatCompactNumber(stats.askDepth)} · Mid ${decimalString(stats.midPrice, 6)} XRP` : "Load the order book for execution quality.")}
      ${row("Mean reversion level", Number.isFinite(vwap) ? `VWAP ${priceText(vwap)}` : "VWAP needs volume or more candles.")}
      ${row("Range map", Number.isFinite(support) && Number.isFinite(resistance) ? `${priceText(support)} support → ${priceText(resistance)} resistance` : "Range pending.")}
    </div>
    <div class="dex-signal-list">
      ${(risk.reasons || []).slice(0, 3).map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}
      ${flags.length ? flags.map((flag) => `<span class="danger">${escapeHtml(flag)}</span>`).join("") : `<span class="safe">No immediate red flags from loaded data.</span>`}
    </div>
  `;
}

function renderDex() {
  populateDexAssetSelect();
  renderDexLookupResults();
  renderDexAccessPanel();
  renderDexStatsPanel();
  renderDexOrderBookPanel();
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexInsightPanel();
  renderDexExecutionPlan();
  renderDexSafetyPanel();
  renderDexTxPreview(state.dex.latestTx ? dexPreviewFromTx(state.dex.latestTx) : null);
  if (refs.dexSignOfferButton) refs.dexSignOfferButton.disabled = state.dex.signing;
}

async function loadDexOrderBook(force = false) {
  const { currency, rawCurrency, issuer } = state.dex;
  if (!currency || !issuer) {
    if (force) setDexTicketStatus("Select an asset or enter currency and issuer before refreshing.", true);
    return;
  }
  if (!XRPL_ADDRESS_PATTERN.test(issuer)) {
    if (force) setDexTicketStatus("Enter a valid XRPL issuer address before refreshing.", true);
    return;
  }
  if (!force && state.dex.orderBook.updatedAt && Date.now() - state.dex.orderBook.updatedAt < 10000) return;

  state.dex.orderBook.loading = true;
  state.dex.orderBook.error = "";
  renderDexStatsPanel();
  renderDexOrderBookPanel();

  const walletState = getWalletState();
  const network = walletState.network || DEFAULT_NETWORK;
  const xrplCurrency = rawCurrency || currency;
  const xrpAsset = { currency: "XRP" };
  const tokenAsset = { currency: xrplCurrency, issuer };

  try {
    const [bidsResult, asksResult] = await Promise.all([
      requestXrplCommand(network, { command: "book_offers", taker_gets: xrpAsset, taker_pays: tokenAsset, ledger_index: "validated", limit: DEX_BOOK_LIMIT }),
      requestXrplCommand(network, { command: "book_offers", taker_gets: tokenAsset, taker_pays: xrpAsset, ledger_index: "validated", limit: DEX_BOOK_LIMIT })
    ]);
    state.dex.orderBook = {
      loading: false,
      error: "",
      bids: (bidsResult.offers || []).map((o) => normalizeDexBookOffer(o, "bids")).filter((o) => o.price > 0).sort((a, b) => b.price - a.price),
      asks: (asksResult.offers || []).map((o) => normalizeDexBookOffer(o, "asks")).filter((o) => o.price > 0).sort((a, b) => a.price - b.price),
      updatedAt: Date.now()
    };
  } catch (err) {
    state.dex.orderBook.loading = false;
    state.dex.orderBook.error = err instanceof Error ? err.message : "Order book request failed.";
  }

  renderDexStatsPanel();
  renderDexOrderBookPanel();
  drawDexAnalysisChart();
  renderDexInsightPanel();
}

function onDexAssetChange() {
  const id = refs.dexAssetSelect?.value || "";
  state.dex.selectedTokenId = id;
  const token = getDexSelectedToken();
  applyDexToken(token);
  state.dex.latestTx = null;
  state.dex.orderBook = { loading: false, error: "", bids: [], asks: [], updatedAt: 0 };
  renderDexTxPreview(null);
  renderDexStatsPanel();
  renderDexOrderBookPanel();
  renderDexInsightPanel();
  void loadDexChart(true);
  if (token) void loadDexOrderBook(true);
}

function onDexInputChange() {
  syncDexStateFromInputs();
  state.dex.latestTx = null;
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexInsightPanel();
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
  if (!XRPL_ADDRESS_PATTERN.test(issuer)) { setDexTicketStatus("Enter a valid XRPL issuer address.", true); return; }
  if (!(toFiniteNumber(amount, 0) > 0)) { setDexTicketStatus("Enter a token amount greater than zero.", true); return; }
  if (!(toFiniteNumber(price, 0) > 0)) { setDexTicketStatus("Enter a limit price greater than zero.", true); return; }

  const tx = buildDexOfferTx();
  if (!tx) { setDexTicketStatus("Could not build offer transaction. Check all fields.", true); return; }

  state.dex.latestTx = tx;
  renderDexTxPreview(dexPreviewFromTx(tx));
  renderDexRiskRewardPanel();
  drawDexAnalysisChart();
  renderDexInsightPanel();
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
    const walletState = getWalletState();
    const provider = walletState.provider || sessionStorage.getItem("ike_wallet_provider");
    if (provider === "created") {
      renderDexTxPreview(dexPreviewFromTx(state.dex.latestTx), `
        <div class="dex-sign-request">
          <strong>Created wallet signing</strong>
          <p>Transaction preview is ready. Import this wallet into Xumm/Xaman, then connect that same account here to sign on-chain.</p>
        </div>
      `);
      setDexTicketStatus("Created wallets can preview offers here. Connect the same account in Xumm/Xaman to sign.", true);
      return;
    }

    if (provider !== "xaman") {
      openAuthModal();
      setDexTicketStatus("Connect Xumm/Xaman before creating a sign request.", true);
      return;
    }

    if (state.dex.latestTx.Account !== walletState.publicAddress) {
      state.dex.latestTx.Account = walletState.publicAddress;
    }

    const xumm = await initXumm(getXamanApiKey());
    const { qrUrl, mobileUrl, resultPromise } = await createTxFlow(xumm, state.dex.latestTx);
    const preview = dexPreviewFromTx(state.dex.latestTx);
    renderDexTxPreview(preview, `
      <div class="dex-sign-request">
        <strong>Xumm/Xaman sign request ready</strong>
        ${qrUrl ? `<img src="${escapeHtml(qrUrl)}" alt="Scan with Xumm/Xaman to sign this DEX offer" loading="lazy" />` : ""}
        ${mobileUrl ? `<a class="ghost table-link" href="${escapeHtml(mobileUrl)}" target="_blank" rel="noopener noreferrer">Open in Xumm/Xaman</a>` : ""}
        <p class="muted">Approve only after the offer details match this preview.</p>
      </div>
    `);
    setDexTicketStatus("Sign request created. Approve or reject it in Xumm/Xaman.");

    const result = await resultPromise;
    if (result?.signed) {
      const txid = result.txid ? ` Transaction: ${result.txid.slice(0, 12)}...` : "";
      setDexTicketStatus(`Offer signed successfully.${txid}`);
      logSecurityEvent("dex_offer_signed", RISK_LEVELS.MEDIUM, {
        context: "dex_offer",
        network: walletState.network,
        addressHint: formatAddress(walletState.publicAddress)
      });
      renderSecurity();
    } else {
      setDexTicketStatus("DEX offer was rejected or cancelled in Xumm/Xaman.", true);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signing failed.";
    setDexTicketStatus(msg, true);
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
    clearNftOfferState();
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
  clearNftOfferState();
  logSecurityEvent("network_changed", RISK_LEVELS.LOW, {
    context: "network_selector",
    network: selected
  });
  renderAll();
}

function onDisconnect() {
  stopTracker();
  clearNftOfferState();
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
  stopTracker();
  clearNftOfferState();
  clearSessionStorage();
  state.tracker.wallets = [];
  state.tracker.feed = [];
  state.tracker.groupFilter = "";
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
    rememberMobileXummPending();
    const xumm = await initXumm(getXamanApiKey());
    setCommandAuthStatus(mobile
      ? "Waiting for approval. If Xumm opened, complete the request there and come back here."
      : "Waiting for wallet approval in Xaman...");
    const account = await signInWithXumm(xumm);
    setCommandAuthStatus("Xumm approved. Loading your XRPL account...");
    const verified = await verifyXummAccount(account);
    if (verified) {
      completeXummAppSession(account);
    } else {
      clearMobileXummPending();
      clearXummSession();
      sessionStorage.removeItem("ike_wallet_provider");
      setWalletProvider("");
      setCommandAuthStatus("Xumm sign in was not successful. The XRPL account could not be loaded.", true);
    }
  } catch (err) {
    if (isExplicitXummRejection(err)) {
      clearMobileXummPending();
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

    clearNftOfferState();
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
  if (state.activePage === "dex" && state.dex.latestTx) {
    const preview = dexPreviewFromTx(state.dex.latestTx);
    refs.signGateContent.innerHTML = `
      <p><strong>Transaction Type:</strong> OfferCreate</p>
      <p><strong>Direction:</strong> ${escapeHtml(preview.side)}</p>
      <p><strong>TakerGets:</strong> ${escapeHtml(preview.takerGets)}</p>
      <p><strong>TakerPays:</strong> ${escapeHtml(preview.takerPays)}</p>
      <p><strong>Limit Price:</strong> ${escapeHtml(preview.price)} XRP per token</p>
      <p><strong>Order Style:</strong> ${escapeHtml(preview.orderStyle)}</p>
      <p><strong>Account:</strong> ${escapeHtml(formatAddress(preview.account || ""))}</p>
      <p><strong>Warning:</strong> XRPL DEX offers can execute immediately and are irreversible after validation.</p>
    `;
    refs.signConfirmCheckbox.checked = false;
    refs.confirmSignButton.disabled = true;
    if (refs.signWithWalletButton) refs.signWithWalletButton.disabled = true;
    refs.signGateModal.classList.remove("hidden");
    refs.signGateModal.style.display = "flex";
    refs.signGateModal.setAttribute("aria-hidden", "false");
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
  clearNftOfferState();
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
  setActivePage("profile");
  setFeedback("New wallet address loaded. Portfolio is ready. Save your private key before funding or signing.");
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

function initSafetyGuideAccordion() {
  const details = Array.from(document.querySelectorAll("details[name]"));
  details.forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return;
      details.forEach((other) => {
        if (other !== item && other.name === item.name) other.open = false;
      });
    });
  });
}

function initEventHandlers() {
  initSafetyGuideAccordion();
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
  [refs.ammToolPoolSelect, refs.ammDepositValueInput, refs.ammPriceMoveInput, refs.ammFeeYieldInput, refs.ammExitPercentInput, refs.ammExitSlippageInput].forEach((el) => {
    el?.addEventListener("input", onAmmToolInputChange);
    el?.addEventListener("change", onAmmToolInputChange);
  });

  // DEX controls
  refs.dexAssetSelect?.addEventListener("change", onDexAssetChange);
  const dexInputs = [refs.dexSideSelect, refs.dexCurrencyInput, refs.dexIssuerInput, refs.dexAmountInput, refs.dexPriceInput, refs.dexOrderStyleSelect, refs.dexSlippageInput, refs.dexStopLossInput, refs.dexTakeProfitInput];
  dexInputs.forEach((el) => {
    el?.addEventListener("input", onDexInputChange);
    el?.addEventListener("change", onDexInputChange);
  });
  bindClick(refs.dexAnalyzeButton, onDexAnalyze);
  bindClick(refs.dexLookupButton, () => { void onDexLookup(); });
  refs.dexLookupInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void onDexLookup();
  });
  refs.dexLookupInput?.addEventListener("input", () => {
    state.dex.lookupStatus = "";
    if (!refs.dexLookupInput.value.trim()) {
      state.dex.lookupResults = [];
      renderDexLookupResults();
    }
  });
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
  window.addEventListener("focus", () => {
    if (hasFreshMobileXummPending()) void resumeMobileXummReturn();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && hasFreshMobileXummPending()) void resumeMobileXummReturn();
  });
  let authCopyResizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(authCopyResizeTimer);
    authCopyResizeTimer = window.setTimeout(renderCommandCenterAuth, 120);
  });
  refs.authModal?.addEventListener("click", (event) => {
    if (event.target === refs.authModal) closeAuthModal();
  });
  document.addEventListener("click", (event) => {
    const authButton = event.target.closest?.("#commandOpenAuthButton, #dexAuthPromptButton");
    if (!authButton) return;
    event.preventDefault();
    openAuthModal();
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
  [refs.portfolioMoodInput, refs.portfolioDensityInput, refs.portfolioGlowInput].forEach((el) => {
    el?.addEventListener("input", savePortfolioStyle);
    el?.addEventListener("change", savePortfolioStyle);
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
  refs.accentSelect?.addEventListener("change", (event) => {
    applyAccent(event.target.value || "aqua");
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
      void renderMarketOverview(true, { forceChart: true });
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
  loadTrackerWallets();
  applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || "dark");
  applyAccent(localStorage.getItem(STORAGE_KEYS.accent) || "aqua");
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
  applyPortfolioStyle();
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
    void renderMarketOverview(true, { forceChart: false });
  }, 15000);
  renderAll();
  void resumeMobileXummReturn();
}

boot();
