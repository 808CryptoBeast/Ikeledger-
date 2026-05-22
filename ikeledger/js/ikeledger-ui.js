import { DEFAULT_NETWORK, NETWORKS, RISK_LEVELS, STORAGE_KEYS } from "./ikeledger-config.js";
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
  getWalletState,
  hydrateWalletState,
  lookupReadOnlyAddress,
  setNetwork,
  setPublicAddress
} from "./ikeledger-wallet.js";
import { getManaSummary } from "./ikeledger-rewards.js";
import { openXamanConnect } from "./ikeledger-xaman.js";
import {
  getSupabaseConfig,
  hasSupabaseConfig,
  linkWalletConnectionRemote,
  logSecurityEventRemote,
  saveSupabaseConfig,
  testSupabaseConnection
} from "./ikeledger-supabase.js";

const BUILDER_ADMIN_CODE = "ike-builder-2026";

const state = {
  adminMode: false,
  latestPreview: null,
  rawJsonOpen: false,
  latestTxItems: []
};

const refs = {
  chips: document.getElementById("statusChips"),
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
  cancelSignButton: document.getElementById("cancelSignButton"),
  openSettingsButton: document.getElementById("openSettingsButton"),
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
  supabaseStatus: document.getElementById("supabaseStatus")
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

function safeNumber(value, decimals = 6) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : "0";
}

function shouldUseSupabaseSync() {
  return state.adminMode && hasSupabaseConfig();
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
    { label: walletState.mode || "Read-only Mode", risk: RISK_LEVELS.SAFE },
    { label: network.label, risk: network.isMainnet ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW },
    { label: walletState.snapshot ? "Wallet Verified" : "Read-only Exploration", risk: walletState.snapshot ? RISK_LEVELS.SAFE : RISK_LEVELS.LOW }
  ];

  refs.chips.innerHTML = chips.map((chip) => `<span class="${chipClass(chip.risk)}">${chip.label}</span>`).join("");
  refs.mainnetWarning?.classList.toggle("hidden", !network.isMainnet);
}

function renderConnectionMeta(walletState) {
  if (!refs.providerStatus) return;
  refs.providerStatus.textContent = walletState.snapshot ? "Read-only XRPL + Xaman ready" : "Xaman / Read-only";
  refs.publicAddressCompact.textContent = formatAddress(walletState.publicAddress);
  refs.walletVerifiedStatus.textContent = walletState.snapshot ? "Yes" : "No";
}

function renderWalletStatus(walletState) {
  if (!refs.walletStatus) return;
  const account = walletState.snapshot?.account;
  refs.walletStatus.innerHTML = `
    <p><strong>XRP Balance:</strong> ${account?.balanceXrp || "0"} XRP</p>
    <p><strong>Available Balance:</strong> ${account?.availableXrp || "0"} XRP</p>
    <p><strong>Owner Reserve:</strong> ${account?.ownerReserveXrp || "0"} XRP</p>
    <p><strong>Sequence:</strong> ${account?.sequence ?? "-"}</p>
    <p><strong>Account Status:</strong> ${account?.accountStatus || "No wallet loaded"}</p>
    <p><strong>Trust Lines:</strong> ${account?.trustLines ?? "-"}</p>
    <p><strong>NFT Count:</strong> ${account?.nftCount ?? "-"}</p>
    <p><strong>Recent Activity:</strong> ${account?.recentActivityCount ?? 0}</p>
  `;
}

function renderPortfolioSummary(walletState) {
  if (!refs.portfolioSummary) return;
  const snapshot = walletState.snapshot;
  refs.portfolioSummary.innerHTML = `
    <p><strong>Total XRP Held:</strong> ${snapshot?.account?.balanceXrp || "0"} XRP</p>
    <p><strong>Available XRP:</strong> ${snapshot?.account?.availableXrp || "0"} XRP</p>
    <p><strong>Tracked Assets:</strong> ${snapshot?.tokenHoldings?.length || 0}</p>
    <p><strong>Issued Projects:</strong> ${snapshot?.issuedTokenEntries?.length || 0}</p>
    <p><strong>NFT Items:</strong> ${snapshot?.nftItems?.length || 0}</p>
    <p><strong>AMM Positions:</strong> ${snapshot?.amm?.objectCount || 0}</p>
    <p><strong>Valuation Mode:</strong> Native XRPL read-only summary</p>
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

function renderProfile(walletState) {
  if (!refs.profileStatus) return;
  const address = walletState.publicAddress;
  refs.profileStatus.innerHTML = `
    <p><strong>Display Name:</strong> Wayfinder Scholar</p>
    <p><strong>Handle:</strong> @ike-journey</p>
    <p><strong>Home Realm:</strong> Dreamtime</p>
    <p><strong>Linked Wallet:</strong> ${formatAddress(address)}</p>
    <p><strong>Connection Status:</strong> ${walletState.snapshot ? "Linked" : "Not linked"}</p>
    <p><strong>Privacy Controls:</strong> Public wallet view / private profile controls.</p>
    <p><strong>Unlink Wallet:</strong> Use Disconnect in wallet controls.</p>
  `;
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
  if (!refs.tokenHoldings) return;
  const holdings = walletState.snapshot?.tokenHoldings || [];
  if (!holdings.length) {
    refs.tokenHoldings.innerHTML = "<p>No issued token balances found.</p>";
    return;
  }

  refs.tokenHoldings.innerHTML = holdings.slice(0, 16).map((token) => {
    const balance = Number.parseFloat(token.balance || "0");
    const risk = balance < 0 ? RISK_LEVELS.MEDIUM : RISK_LEVELS.LOW;
    return `
      <div class="asset-item">
        <p class="asset-label">${token.currency}</p>
        <p>Balance: ${token.balance}</p>
        <p>Issuer: ${formatAddress(token.counterparty)}</p>
        <p>Risk: <span class="${chipClass(risk)}">${risk}</span></p>
      </div>
    `;
  }).join("");
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

function renderNfts(walletState) {
  if (!refs.nftInventory) return;
  const nfts = walletState.snapshot?.nftItems || [];
  if (!nfts.length) {
    refs.nftInventory.innerHTML = "<p>No NFTs in this account yet.</p>";
    return;
  }

  refs.nftInventory.innerHTML = nfts.slice(0, 10).map((nft) => `
    <div class="nft-item">
      <div class="nft-thumb" aria-hidden="true"></div>
      <p><strong>ID:</strong> ${formatAddress(nft.nftId)}</p>
      <p><strong>Issuer:</strong> ${formatAddress(nft.issuer)}</p>
      <p><strong>Collection:</strong> Taxon ${nft.taxon}</p>
      <p><strong>Metadata:</strong> Preview pending gateway source</p>
    </div>
  `).join("");
}

function renderAmm(walletState) {
  if (!refs.ammStatus) return;
  const amm = walletState.snapshot?.amm || { objectCount: 0, recentActivityCount: 0, recentActivity: [] };
  refs.ammStatus.innerHTML = `
    <p><strong>AMM Positions:</strong> ${amm.objectCount}</p>
    <p><strong>Recent AMM Actions:</strong> ${amm.recentActivityCount}</p>
    <p><strong>Latest Action:</strong> ${amm.recentActivity[0]?.type || "None"}</p>
    <p><strong>Value Signal:</strong> Pool pricing requires pair quotes.</p>
  `;
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

  refs.txPreview.innerHTML = `
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

function renderSecurity() {
  if (!refs.securityStatus) return;
  const events = getSecurityEvents();
  if (!events.length) {
    refs.securityStatus.innerHTML = `
      <p><strong>Checklist:</strong> Seed phrase blocked, private key blocked, network warning active.</p>
      <p><strong>Status:</strong> Protected connection</p>
      <p><strong>Events:</strong> No recent warnings</p>
    `;
    return;
  }

  refs.securityStatus.innerHTML = events.slice(0, 6).map((event) =>
    `<p><strong>${event.riskLevel}</strong> - ${event.eventType} (${new Date(event.createdAt).toLocaleString()})</p>`
  ).join("");
}

function renderAll() {
  const walletState = getWalletState();
  renderChips(walletState);
  renderConnectionMeta(walletState);
  renderPortfolioSummary(walletState);
  renderWalletStatus(walletState);
  renderMana(walletState);
  renderProfile(walletState);
  renderProofLearning(walletState);
  renderBadges(walletState);
  renderTokenHoldings(walletState);
  renderIssuedTokens(walletState);
  renderNfts(walletState);
  renderAmm(walletState);
  renderValueMix(walletState);
  renderTxHistory(walletState);
  renderTxPreview(walletState);
  renderSecurity();
}

function renderAdminPanel() {
  refs.adminPanel?.classList.toggle("hidden", !state.adminMode);
  setAdminStatus(state.adminMode ? "Builder admin unlocked." : "Builder admin locked.");
}

function openSettingsDrawer() {
  refs.settingsDrawer?.classList.remove("hidden");
}

function closeSettingsDrawer() {
  refs.settingsDrawer?.classList.add("hidden");
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
  if (refs.addressInput) refs.addressInput.value = "";
  logSecurityEvent("wallet_disconnected", RISK_LEVELS.LOW, { context: "manual" });
  setFeedback("Wallet disconnected.");
  renderAll();
}

function onClearSession() {
  clearSessionStorage();
  if (refs.addressInput) refs.addressInput.value = "";
  logSecurityEvent("session_cleared", RISK_LEVELS.SAFE, { context: "manual" });
  setFeedback("Session cleared.");
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

function onConnectXaman() {
  void (async () => {
    const walletState = getWalletState();
    const context = openXamanConnect(walletState.network, walletState.publicAddress);
    if (refs.xamanStatus) {
      refs.xamanStatus.textContent = `${context.provider} opened for ${context.network}. ${context.note}`;
    }

    logSecurityEvent("xaman_connect_started", RISK_LEVELS.LOW, {
      context: "provider_connect",
      network: walletState.network,
      addressHint: formatAddress(walletState.publicAddress)
    });

    await pushSecurityEventToSupabase("xaman_connect_started", RISK_LEVELS.LOW, walletState.publicAddress, {
      context: "provider_connect",
      network: walletState.network,
      addressHint: formatAddress(walletState.publicAddress)
    });

    if (shouldUseSupabaseSync() && walletState.publicAddress) {
      const result = await linkWalletConnectionRemote({
        walletAddress: walletState.publicAddress,
        network: walletState.network,
        provider: "xaman",
        verified: false
      });
      if (!result.ok) {
        setSupabaseStatus(result.message, true);
      }
    }

    renderSecurity();
  })();
}

function openSignGateModal() {
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
  refs.signGateModal.classList.remove("hidden");
}

function closeSignGateModal() {
  refs.signGateModal?.classList.add("hidden");
}

function onConfirmSignIntent() {
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
    closeSignGateModal();
    renderSecurity();
  })();
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
  bindClick(refs.connectXamanButton, onConnectXaman);
  bindClick(refs.toggleRawJsonButton, toggleRawJson);

  bindClick(refs.openSignGateButton, openSignGateModal);
  bindClick(refs.cancelSignButton, closeSignGateModal);
  bindClick(refs.confirmSignButton, onConfirmSignIntent);
  refs.signConfirmCheckbox?.addEventListener("change", (event) => {
    refs.confirmSignButton.disabled = !event.target.checked;
  });
  refs.signGateModal?.addEventListener("click", (event) => {
    if (event.target === refs.signGateModal) closeSignGateModal();
  });

  bindClick(refs.openSettingsButton, openSettingsDrawer);
  bindClick(refs.closeSettingsButton, closeSettingsDrawer);
  bindClick(refs.settingsDisconnectButton, onDisconnect);
  bindClick(refs.settingsClearSessionButton, onClearSession);
  bindClick(refs.adminUnlockButton, onUnlockAdmin);
  bindClick(refs.adminLockButton, onLockAdmin);
  bindClick(refs.saveSupabaseButton, onSaveSupabase);
  bindClick(refs.testSupabaseButton, onTestSupabase);
  refs.settingsDrawer?.addEventListener("click", (event) => {
    if (event.target === refs.settingsDrawer) closeSettingsDrawer();
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
  initEventHandlers();
  renderAll();
}

boot();
