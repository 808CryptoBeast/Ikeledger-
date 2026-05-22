import { DEFAULT_NETWORK, NETWORKS, RISK_LEVELS } from "./ikeledger-config.js";
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

const state = {
  isLoading: false
};

const refs = {
  chips: document.getElementById("statusChips"),
  reminders: document.getElementById("safetyReminders"),
  networkSelect: document.getElementById("networkSelect"),
  addressInput: document.getElementById("addressInput"),
  mainnetWarning: document.getElementById("mainnetWarning"),
  lookupButton: document.getElementById("lookupButton"),
  demoButton: document.getElementById("demoButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  clearSessionButton: document.getElementById("clearSessionButton"),
  feedback: document.getElementById("feedback"),
  walletStatus: document.getElementById("walletStatus"),
  manaStatus: document.getElementById("manaStatus"),
  txHistory: document.getElementById("txHistory"),
  txPreview: document.getElementById("txPreview"),
  securityStatus: document.getElementById("securityStatus")
};

function chipClass(level) {
  if (level === RISK_LEVELS.SAFE) return "chip chip-safe";
  if (level === RISK_LEVELS.LOW) return "chip chip-low";
  if (level === RISK_LEVELS.MEDIUM) return "chip chip-medium";
  if (level === RISK_LEVELS.HIGH) return "chip chip-high";
  return "chip chip-blocked";
}

function setFeedback(text, isError = false) {
  refs.feedback.textContent = text;
  refs.feedback.style.color = isError ? "#8f2c20" : "#55665a";
}

function formatAddress(address = "") {
  if (!address) return "-";
  if (address.length < 12) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function txToPreview(tx, networkLabel) {
  if (!tx) {
    return {
      type: "None",
      summary: "No transaction selected yet.",
      risk: RISK_LEVELS.SAFE,
      irreversible: false
    };
  }

  const risk = tx.type === "Payment" ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW;

  return {
    type: tx.type,
    summary: tx.label,
    fee: tx.fee,
    risk,
    networkLabel,
    irreversible: tx.type === "Payment"
  };
}

function renderReminders() {
  refs.reminders.innerHTML = reminderMessages()
    .map((item) => `<li>${item}</li>`)
    .join("");
}

function renderChips(walletState) {
  const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
  const chips = [
    { label: walletState.status, risk: assessRisk("wallet_connect") },
    { label: walletState.mode || "Read-only Mode", risk: RISK_LEVELS.SAFE },
    { label: network.isMainnet ? "Mainnet" : "Testnet/Devnet", risk: network.isMainnet ? RISK_LEVELS.HIGH : RISK_LEVELS.LOW },
    { label: "Protected", risk: RISK_LEVELS.SAFE }
  ];

  refs.chips.innerHTML = chips
    .map((chip) => `<span class="${chipClass(chip.risk)}">${chip.label}</span>`)
    .join("");

  refs.mainnetWarning.classList.toggle("hidden", !network.isMainnet);
}

function renderWalletStatus(walletState) {
  const snapshot = walletState.snapshot;

  refs.walletStatus.innerHTML = `
    <p><strong>State:</strong> ${walletState.status}</p>
    <p><strong>Address:</strong> ${formatAddress(walletState.publicAddress)}</p>
    <p><strong>Network:</strong> ${(NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK]).label}</p>
    <p><strong>Balance:</strong> ${snapshot?.account?.balanceXrp || "0"} XRP</p>
    <p><strong>Sequence:</strong> ${snapshot?.account?.sequence ?? "-"}</p>
    <p><strong>Trust Lines:</strong> ${snapshot?.account?.trustLines ?? "-"}</p>
    <p><strong>NFTs:</strong> ${snapshot?.account?.nftCount ?? "-"}</p>
  `;
}

function renderMana(walletState) {
  const mana = getManaSummary(walletState.publicAddress);
  refs.manaStatus.innerHTML = `
    <p><strong>Mana Balance:</strong> ${mana.mana}</p>
    <p><strong>Completed Lessons:</strong> ${mana.completedLessons}</p>
    <p><strong>Badges:</strong> ${mana.badges.join(", ") || "None"}</p>
    <p><strong>Verification:</strong> Learning progress anchor only. Not cultural ownership.</p>
  `;
}

function renderTxHistory(walletState) {
  const txItems = walletState.snapshot?.txItems || [];
  if (!txItems.length) {
    refs.txHistory.innerHTML = "<p>No recent validated transactions in current session.</p>";
    return;
  }

  refs.txHistory.innerHTML = txItems
    .map((tx) => `
      <div class="tx-item">
        <p><strong>${tx.label}</strong></p>
        <p>Type: ${tx.type} | Fee: ${tx.fee} drops</p>
        <p>Hash: ${formatAddress(tx.hash)}</p>
      </div>
    `)
    .join("");
}

function renderTxPreview(walletState) {
  const network = NETWORKS[walletState.network] || NETWORKS[DEFAULT_NETWORK];
  const firstTx = walletState.snapshot?.txItems?.[0];
  const preview = txToPreview(firstTx, network.label);

  refs.txPreview.innerHTML = `
    <p><strong>Transaction Type:</strong> ${preview.type}</p>
    <p><strong>Summary:</strong> ${preview.summary}</p>
    <p><strong>Network:</strong> ${preview.networkLabel || "-"}</p>
    <p><strong>Estimated Fee:</strong> ${preview.fee || "0"} drops</p>
    <p><strong>Risk Level:</strong> ${preview.risk}</p>
    <p><strong>Finality:</strong> ${preview.irreversible ? "Final once validated" : "Varies by action"}</p>
  `;
}

function renderSecurity() {
  const events = getSecurityEvents();
  if (!events.length) {
    refs.securityStatus.innerHTML = "<p>No active security alerts in this session.</p>";
    return;
  }

  refs.securityStatus.innerHTML = events
    .slice(0, 5)
    .map(
      (event) =>
        `<p><strong>${event.riskLevel}</strong> - ${event.eventType} (${new Date(event.createdAt).toLocaleString()})</p>`
    )
    .join("");
}

function renderAll() {
  const walletState = getWalletState();
  renderChips(walletState);
  renderWalletStatus(walletState);
  renderMana(walletState);
  renderTxHistory(walletState);
  renderTxPreview(walletState);
  renderSecurity();
}

async function onLookup() {
  const address = refs.addressInput.value.trim();
  if (!address) {
    setFeedback("Enter a public XRPL address.", true);
    return;
  }

  if (looksLikeSensitiveInput(address)) {
    refs.addressInput.value = "";
    logSecurityEvent("blocked_secret_input", RISK_LEVELS.BLOCKED, {
      context: "address_input",
      network: refs.networkSelect.value,
      addressHint: "blocked"
    });
    setFeedback(
      "For your safety, IkeLedger does not accept seed phrases, secrets, or private keys.",
      true
    );
    renderSecurity();
    return;
  }

  state.isLoading = true;
  setFeedback("Loading XRPL account snapshot...");

  try {
    setPublicAddress(address);
    await lookupReadOnlyAddress(address);
    setFeedback("Read-only lookup complete.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed.";
    logSecurityEvent("wallet_lookup_failed", RISK_LEVELS.MEDIUM, {
      context: "lookup",
      network: refs.networkSelect.value,
      addressHint: formatAddress(address)
    });
    setFeedback(message, true);
  } finally {
    state.isLoading = false;
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
  refs.addressInput.value = "";
  logSecurityEvent("wallet_disconnected", RISK_LEVELS.LOW, { context: "manual" });
  setFeedback("Wallet disconnected and session address removed.");
  renderAll();
}

function onClearSession() {
  clearSessionStorage();
  refs.addressInput.value = "";
  logSecurityEvent("session_cleared", RISK_LEVELS.SAFE, { context: "manual" });
  setFeedback("Session cleared. Non-sensitive settings reset.");
  renderAll();
}

function onLoadDemo() {
  const demoAddress = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
  refs.addressInput.value = demoAddress;
  setFeedback("Demo address loaded. Click Lookup Address.");
}

function initNetworkOptions() {
  refs.networkSelect.innerHTML = Object.values(NETWORKS)
    .map((network) => `<option value="${network.key}">${network.label}</option>`)
    .join("");
}

function initEventHandlers() {
  refs.lookupButton.addEventListener("click", onLookup);
  refs.networkSelect.addEventListener("change", onNetworkChange);
  refs.disconnectButton.addEventListener("click", onDisconnect);
  refs.clearSessionButton.addEventListener("click", onClearSession);
  refs.demoButton.addEventListener("click", onLoadDemo);

  refs.addressInput.addEventListener("paste", (event) => {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (looksLikeSensitiveInput(pastedText)) {
      event.preventDefault();
      refs.addressInput.value = "";
      logSecurityEvent("blocked_secret_paste", RISK_LEVELS.BLOCKED, {
        context: "paste_blocked",
        network: refs.networkSelect.value,
        addressHint: "blocked"
      });
      setFeedback(
        "For your safety, IkeLedger does not accept seed phrases, secrets, or private keys.",
        true
      );
      renderSecurity();
    }
  });
}

function boot() {
  initNetworkOptions();
  const walletState = hydrateWalletState();
  refs.networkSelect.value = walletState.network;
  refs.addressInput.value = walletState.publicAddress || "";
  renderReminders();
  initEventHandlers();
  renderAll();
}

boot();
