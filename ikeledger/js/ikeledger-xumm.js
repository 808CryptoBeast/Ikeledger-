// Official Xumm/Xaman browser SDK wrapper for IkeLedger.
// CDN package: https://xumm.app/assets/cdn/xumm.min.js

let xummClient = null;
let xummApiKey = "";
let readyPromise = null;
const XUMM_PKCE_STORAGE_KEY = "XummPkceJwt";

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
  try { localStorage.removeItem(XUMM_PKCE_STORAGE_KEY); } catch {}
  try { sessionStorage.removeItem(XUMM_PKCE_STORAGE_KEY); } catch {}

  const result = await xumm.authorize();
  if (result instanceof Error) throw result;

  const account = result?.me?.account
    || result?.me?.sub
    || xumm.state?.account
    || await xumm.user.account
    || "";

  if (!account) {
    throw new Error("Xumm sign in completed, but no XRPL account was returned.");
  }

  return account;
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
