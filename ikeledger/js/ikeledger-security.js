import { RISK_LEVELS } from "./ikeledger-config.js";

const SENSITIVE_PATTERNS = [
  /\bseed\b/i,
  /\bsecret\b/i,
  /\bprivate\s*key\b/i,
  /\brecovery\s*phrase\b/i,
  /\bfamily\s*seed\b/i,
  /\bs[1-9A-HJ-NP-Za-km-z]{20,60}\b/, 
  /\bed[0-9A-Za-z]{20,80}\b/
];

const securityEvents = [];

export function looksLikeSensitiveInput(value) {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.split(/\s+/).length >= 12) {
    return true;
  }

  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function assessRisk(action, context = {}) {
  if (action === "read_only_lookup") {
    return RISK_LEVELS.SAFE;
  }

  if (action === "wallet_connect") {
    return RISK_LEVELS.LOW;
  }

  if (action === "message_sign") {
    return RISK_LEVELS.MEDIUM;
  }

  if (action === "transaction_submit") {
    return context.isMainnet ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM;
  }

  if (action === "unknown_transaction" || action === "seed_phrase_request") {
    return RISK_LEVELS.BLOCKED;
  }

  return RISK_LEVELS.LOW;
}

export function reminderMessages() {
  return [
    "IkeLedger never asks for your seed phrase or private key.",
    "Only sign transactions you understand.",
    "Connecting a wallet does not allow IkeLedger to move your funds.",
    "Always verify the network before approving any transaction."
  ];
}

export function logSecurityEvent(eventType, riskLevel, details = {}) {
  const safeDetails = {
    context: String(details.context || ""),
    network: String(details.network || ""),
    addressHint: String(details.addressHint || "")
  };

  securityEvents.unshift({
    eventType,
    riskLevel,
    details: safeDetails,
    createdAt: new Date().toISOString()
  });

  if (securityEvents.length > 30) {
    securityEvents.pop();
  }
}

export function getSecurityEvents() {
  return [...securityEvents];
}
