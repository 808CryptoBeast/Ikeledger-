export const APP_NAME = "IkeLedger";

// Public Xaman app key. This only identifies IkeLedger to Xaman.
// Safe to include in frontend code. DO NOT include the API Secret here.
// Rotate the secret at apps.xaman.app if it was ever exposed outside the server.
export const XAMAN_API_KEY = "4181bda5-a4d1-4f41-b02e-93a739ac3116";

export const NETWORKS = {
  "xrpl-testnet": {
    key: "xrpl-testnet",
    label: "XRPL Testnet",
    endpoint: "wss://s.altnet.rippletest.net:51233",
    endpoints: ["wss://s.altnet.rippletest.net:51233"],
    isMainnet: false,
    warning: "Learning mode recommended."
  },
  "xrpl-mainnet": {
    key: "xrpl-mainnet",
    label: "XRPL Mainnet",
    endpoint: "wss://s1.ripple.com",
    endpoints: ["wss://s1.ripple.com", "wss://s2.ripple.com", "wss://xrplcluster.com"],
    isMainnet: true,
    warning: "Real assets may be involved."
  }
};

export const DEFAULT_NETWORK = "xrpl-testnet";

export const STORAGE_KEYS = {
  network: "ikeledger.network",
  publicAddress: "ikeledger.publicAddress",
  connectionPreference: "ikeledger.connectionPreference",
  profileDisplayName: "ikeledger.profileDisplayName",
  profileHandle: "ikeledger.profileHandle",
  profileBio: "ikeledger.profileBio",
  profileRealm: "ikeledger.profileRealm",
  profileInitials: "ikeledger.profileInitials",
  appUserSession: "ikeledger.appUserSession",
  supabaseUrl: "ikeledger.supabaseUrl",
  supabaseAnonKey: "ikeledger.supabaseAnonKey",
  adminMode: "ikeledger.adminMode",
  theme: "ikeledger.theme",
  accent: "ikeledger.accent",
  completedLessons: "ikeledger.completedLessons",
  profilePhoto: "ikeledger.profilePhoto",
  profileBanner: "ikeledger.profileBanner",
  profileShareWallet: "ikeledger.profileShareWallet",
  profileBadgeSelection: "ikeledger.profileBadgeSelection",
  avatarGlowColor: "ikeledger.avatarGlowColor",
  avatarGlowIntensity: "ikeledger.avatarGlowIntensity",
  avatarBorderColor: "ikeledger.avatarBorderColor",
  avatarBorderShape: "ikeledger.avatarBorderShape",
  avatarBorderWidth: "ikeledger.avatarBorderWidth",
  portfolioMood: "ikeledger.portfolioMood",
  portfolioDensity: "ikeledger.portfolioDensity",
  portfolioGlow: "ikeledger.portfolioGlow",
  portfolioFont: "ikeledger.portfolioFont",
  portfolioBackground: "ikeledger.portfolioBackground",
  portfolioTextColor: "ikeledger.portfolioTextColor",
  portfolioMutedColor: "ikeledger.portfolioMutedColor",
  portfolioCardColor: "ikeledger.portfolioCardColor",
  portfolioCardBorderColor: "ikeledger.portfolioCardBorderColor",
  portfolioCardBorderWidth: "ikeledger.portfolioCardBorderWidth",
  portfolioCardRadius: "ikeledger.portfolioCardRadius",
  portfolioPreset: "ikeledger.portfolioPreset",
  portfolioBadgePlacement: "ikeledger.portfolioBadgePlacement",
  portfolioSectionOrder: "ikeledger.portfolioSectionOrder",
  portfolioBorderAnimation: "ikeledger.portfolioBorderAnimation",
  portfolioPublicPreview: "ikeledger.portfolioPublicPreview",
  tokenWatchlist: "ikeledger.tokenWatchlist",
  ammWatchlist: "ikeledger.ammWatchlist",
  marketProxyBaseUrl: "ikeledger.marketProxyBaseUrl",
  learningMode: "ikeledger.learningMode"
};

export const RISK_LEVELS = {
  SAFE: "Safe",
  LOW: "Low Risk",
  MEDIUM: "Medium Risk",
  HIGH: "High Risk",
  BLOCKED: "Blocked"
};

export const XRPL_ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/;
