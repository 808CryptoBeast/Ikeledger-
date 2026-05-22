export const APP_NAME = "IkeLedger";

export const NETWORKS = {
  "xrpl-testnet": {
    key: "xrpl-testnet",
    label: "XRPL Testnet",
    endpoint: "wss://s.altnet.rippletest.net:51233",
    isMainnet: false,
    warning: "Learning mode recommended."
  },
  "xrpl-mainnet": {
    key: "xrpl-mainnet",
    label: "XRPL Mainnet",
    endpoint: "wss://xrplcluster.com",
    isMainnet: true,
    warning: "Real assets may be involved."
  },
  "xrpl-devnet": {
    key: "xrpl-devnet",
    label: "XRPL Devnet",
    endpoint: "wss://s.devnet.rippletest.net:51233",
    isMainnet: false,
    warning: "Experimental network for development."
  }
};

export const DEFAULT_NETWORK = "xrpl-testnet";

export const STORAGE_KEYS = {
  network: "ikeledger.network",
  publicAddress: "ikeledger.publicAddress",
  connectionPreference: "ikeledger.connectionPreference",
  theme: "ikeledger.theme",
  completedLessons: "ikeledger.completedLessons"
};

export const RISK_LEVELS = {
  SAFE: "Safe",
  LOW: "Low Risk",
  MEDIUM: "Medium Risk",
  HIGH: "High Risk",
  BLOCKED: "Blocked"
};

export const XRPL_ADDRESS_PATTERN = /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/;
