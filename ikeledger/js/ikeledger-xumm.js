// Official Xumm/Xaman browser SDK wrapper for IkeLedger.
// CDN package: https://xumm.app/assets/cdn/xumm.min.js

let xummClient = null;
let xummApiKey = "";
let readyPromise = null;
const XUMM_PKCE_STORAGE_KEY = "XummPkceJwt";
const XUMM_ACCOUNT_RECOVERY_MS = 90000;
const XUMM_ACCOUNT_POLL_MS = 500;
const XUMM_EXISTING_ACCOUNT_MS = 1500;
const XUMM_AUTHORIZE_EVENT_MS = 90000;

export async function loadXummCDN() {
  if (typeof window === "undefined") return;
  if (window.Xumm) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://xumm.app/assets/cdn/xumm.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Xumm SDK failed to load. Check your connection and try again."));
    document.head.appendChild(script);
  });
}

export async function initXumm(apiKey) {
  if (!apiKey) throw new Error("Xumm app key is missing.");

  if (xummClient && xummApiKey === apiKey) {
    if (readyPromise) await readyPromise;
    return xummClient;
  }

  await loadXummCDN();
  xummClient = new window.Xumm(apiKey);
  xummApiKey = apiKey;
  readyPromise = new Promise(resolve => {
    xummClient.on("ready", resolve);
    setTimeout(resolve, 5000);
  });

  await readyPromise;
  return xummClient;
}

export async function signInWithXumm(xumm) {
  const existingAccount = await waitForXummAccount(xumm, XUMM_EXISTING_ACCOUNT_MS);
  if (existingAccount) return existingAccount;

  let result = null;
  let authorizeError = null;
  const successSignal = waitForXummSuccess(xumm, XUMM_AUTHORIZE_EVENT_MS);

  try {
    result = await Promise.race([
      xumm.authorize(),
      successSignal.then(() => ({ signInEvent: "success" }))
    ]);
    if (result instanceof Error) {
      authorizeError = result;
    }
  } catch (error) {
    authorizeError = error instanceof Error ? error : new Error("Xumm sign in did not complete.");
  }

  const account = result?.me?.account
    || result?.me?.sub
    || xumm.state?.account
    || await Promise.race([
      xumm.user.account,
      new Promise(resolve => setTimeout(() => resolve(""), XUMM_ACCOUNT_POLL_MS))
    ]).catch(() => "")
    || "";

  if (account) return account;

  const recoveredAccount = await waitForXummAccount(xumm, XUMM_ACCOUNT_RECOVERY_MS);
  if (recoveredAccount) return recoveredAccount;

  if (authorizeError) throw authorizeError;

  throw new Error("Xumm sign in was not completed. No wallet approval was received.");
}

export async function waitForXummAccount(xumm, timeoutMs = XUMM_ACCOUNT_RECOVERY_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const account = xumm?.state?.account || await Promise.race([
      xumm?.user?.account || Promise.resolve(""),
      new Promise(resolve => setTimeout(() => resolve(""), XUMM_ACCOUNT_POLL_MS))
    ]).catch(() => "");

    if (account) return account;
    await new Promise(resolve => setTimeout(resolve, XUMM_ACCOUNT_POLL_MS));
  }

  return "";
}

function waitForXummSuccess(xumm, timeoutMs = XUMM_AUTHORIZE_EVENT_MS) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value = false) => {
      if (done) return;
      done = true;
      try { xumm?.off?.("success", onSuccess); } catch {}
      resolve(value);
    };
    const onSuccess = () => finish(true);

    try { xumm?.on?.("success", onSuccess); } catch {}
    xumm?.environment?.success?.then(() => finish(true)).catch(() => {});
    setTimeout(() => finish(false), timeoutMs);
  });
}

export function clearXummSession() {
  if (xummClient) {
    try { xummClient.logout(); } catch {}
  }
  try { localStorage.removeItem(XUMM_PKCE_STORAGE_KEY); } catch {}
  try { sessionStorage.removeItem(XUMM_PKCE_STORAGE_KEY); } catch {}
  xummClient = null;
  xummApiKey = "";
  readyPromise = null;
}

export async function createTxFlow(xumm, txJson) {
  if (!xumm.state?.account) {
    await signInWithXumm(xumm);
  }

  const payload = await xumm.payload.create({ txjson: txJson });

  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  xumm.payload.subscribe(payload.uuid, event => {
    if (!Object.prototype.hasOwnProperty.call(event.data || {}, "signed")) return;

    resolveResult({
      signed: event.data.signed === true,
      txid: event.data?.payload?.response?.txid
        || event.data?.response?.txid
        || ""
    });
    return event;
  }).catch(error => {
    rejectResult(error instanceof Error ? error : new Error("Xumm subscription failed."));
  });

  return {
    qrUrl: payload.refs?.qr_png || "",
    mobileUrl: payload.next?.always || "",
    uuid: payload.uuid || "",
    resultPromise
  };
}

export function resetXumm() {
  clearXummSession();
}
