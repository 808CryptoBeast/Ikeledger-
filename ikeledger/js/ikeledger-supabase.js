import { STORAGE_KEYS } from "./ikeledger-config.js";
import { importFromCdn } from "./ikeledger-cdn.js";

let clientCache = null;
let cacheKey = "";

const SUPABASE_CDN_URLS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm",
  "https://esm.sh/@supabase/supabase-js@2.49.8?bundle"
];

function normalize(value) {
  return (value || "").trim();
}

export function getSupabaseConfig() {
  return {
    url: normalize(localStorage.getItem(STORAGE_KEYS.supabaseUrl)),
    anonKey: normalize(localStorage.getItem(STORAGE_KEYS.supabaseAnonKey))
  };
}

export function saveSupabaseConfig(url, anonKey) {
  const cleanUrl = normalize(url);
  const cleanKey = normalize(anonKey);

  localStorage.setItem(STORAGE_KEYS.supabaseUrl, cleanUrl);
  localStorage.setItem(STORAGE_KEYS.supabaseAnonKey, cleanKey);

  clientCache = null;
  cacheKey = "";
}

export function hasSupabaseConfig() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

async function getSupabaseClient() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  const nextKey = `${url}::${anonKey}`;
  if (clientCache && cacheKey === nextKey) {
    return clientCache;
  }

  const { createClient } = await importFromCdn(SUPABASE_CDN_URLS, "@supabase/supabase-js@2.49.8");
  clientCache = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  cacheKey = nextKey;
  return clientCache;
}

function cleanError(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

export async function testSupabaseConnection() {
  try {
    const client = await getSupabaseClient();
    const { error } = await client.auth.getSession();
    if (error) {
      return { ok: false, message: cleanError(error, "Supabase auth/session request failed.") };
    }

    return { ok: true, message: "Supabase connection OK." };
  } catch (error) {
    return { ok: false, message: cleanError(error, "Failed to initialize Supabase client.") };
  }
}

export async function signUpWithEmail({ email, password, username }) {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });

    if (error) {
      return { ok: false, message: cleanError(error, "Email sign up failed."), data: null };
    }

    return { ok: true, message: "Verification email sent. Check your inbox before signing in.", data };
  } catch (error) {
    return { ok: false, message: cleanError(error, "Supabase auth is not configured."), data: null };
  }
}

export async function signInWithEmail({ email, password }) {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      return { ok: false, message: cleanError(error, "Email sign in failed."), data: null };
    }

    return { ok: true, message: "Signed in.", data };
  } catch (error) {
    return { ok: false, message: cleanError(error, "Supabase auth is not configured."), data: null };
  }
}

export async function signOutEmailAuth() {
  try {
    const client = await getSupabaseClient();
    await client.auth.signOut();
  } catch {
    // Local sign-out should still proceed even if Supabase is unavailable.
  }
}

export async function linkWalletConnectionRemote(payload) {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc("link_wallet_connection", {
      p_wallet_address: payload.walletAddress,
      p_network: payload.network,
      p_provider: payload.provider,
      p_verified: Boolean(payload.verified)
    });

    if (error) {
      return { ok: false, message: cleanError(error, "Failed to link wallet in Supabase."), data: null };
    }

    return { ok: true, message: "Wallet linked in Supabase.", data };
  } catch (error) {
    return { ok: false, message: cleanError(error, "Failed to call link_wallet_connection."), data: null };
  }
}

export async function logSecurityEventRemote(payload) {
  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc("log_security_event", {
      p_event_type: payload.eventType,
      p_risk_level: payload.riskLevel,
      p_wallet_address: payload.walletAddress || null,
      p_details: payload.details || {}
    });

    if (error) {
      return { ok: false, message: cleanError(error, "Failed to log security event in Supabase."), data: null };
    }

    return { ok: true, message: "Security event logged in Supabase.", data };
  } catch (error) {
    return { ok: false, message: cleanError(error, "Failed to call log_security_event."), data: null };
  }
}
