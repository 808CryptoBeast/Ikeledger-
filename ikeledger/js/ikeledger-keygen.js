// Browser-native XRPL wallet generation — no external dependencies.
// Private keys NEVER touch localStorage or any persistent storage.

const XRPL_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

// RIPEMD-160 round constants
const KL = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E];
const KR = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000];

// Message schedule indices
const RL = [
  0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,
  7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,
  3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,
  1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,
  4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13
];
const RR = [
  5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,
  6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,
  15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,
  8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,
  12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11
];

// Shift amounts
const SL = [
  11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,
  7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,
  11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,
  11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,
  9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6
];
const SR = [
  8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,
  9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,
  9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,
  15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,
  8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11
];

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function fl(j, x, y, z) {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  if (j < 32) return ((x & y) | (~x & z)) >>> 0;
  if (j < 48) return ((x | ~y) ^ z) >>> 0;
  if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
  return (x ^ (y | ~z)) >>> 0;
}

function fr(j, x, y, z) {
  if (j < 16) return (x ^ (y | ~z)) >>> 0;
  if (j < 32) return ((x & z) | (y & ~z)) >>> 0;
  if (j < 48) return ((x | ~y) ^ z) >>> 0;
  if (j < 64) return ((x & y) | (~x & z)) >>> 0;
  return (x ^ y ^ z) >>> 0;
}

function ripemd160(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const bitLen = bytes.length * 8;

  // Pad message
  const padded = [];
  for (const b of bytes) padded.push(b);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  // Append length as little-endian 64-bit
  for (let i = 0; i < 4; i++) padded.push((bitLen >>> (i * 8)) & 0xff);
  for (let i = 0; i < 4; i++) padded.push(0); // high 32 bits always 0

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const X = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      X[i] = (padded[offset + i*4]) |
              (padded[offset + i*4 + 1] << 8) |
              (padded[offset + i*4 + 2] << 16) |
              (padded[offset + i*4 + 3] << 24);
    }

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

    for (let j = 0; j < 80; j++) {
      let tl = rotl32(
        (al + fl(j, bl, cl, dl) + X[RL[j]] + KL[Math.floor(j / 16)]) >>> 0,
        SL[j]
      );
      tl = (tl + el) >>> 0;
      al = el; el = dl; dl = rotl32(cl, 10); cl = bl; bl = tl;

      let tr = rotl32(
        (ar + fr(j, br, cr, dr) + X[RR[j]] + KR[Math.floor(j / 16)]) >>> 0,
        SR[j]
      );
      tr = (tr + er) >>> 0;
      ar = er; er = dr; dr = rotl32(cr, 10); cr = br; br = tr;
    }

    const t = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = t;
  }

  const result = new Uint8Array(20);
  const view = new DataView(result.buffer);
  view.setUint32(0, h0, true);
  view.setUint32(4, h1, true);
  view.setUint32(8, h2, true);
  view.setUint32(12, h3, true);
  view.setUint32(16, h4, true);
  return result;
}

async function sha256(data) {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

function toBase58(bytes) {
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);

  let encoded = "";
  while (num > 0n) {
    const rem = num % 58n;
    encoded = XRPL_ALPHABET[Number(rem)] + encoded;
    num = num / 58n;
  }

  for (const b of bytes) {
    if (b !== 0) break;
    encoded = XRPL_ALPHABET[0] + encoded;
  }

  return encoded;
}

async function base58CheckEncode(versionedPayload) {
  const first = await sha256(versionedPayload);
  const second = await sha256(first);
  const checksum = second.slice(0, 4);
  const full = new Uint8Array(versionedPayload.length + 4);
  full.set(versionedPayload, 0);
  full.set(checksum, versionedPayload.length);
  return toBase58(full);
}

export function isKeygenSupported() {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle !== "undefined" &&
      typeof crypto.subtle.generateKey === "function"
    );
  } catch {
    return false;
  }
}

export async function generateXrplWallet() {
  if (!isKeygenSupported()) {
    throw new Error("Web Crypto API not available in this browser.");
  }

  // Generate Ed25519 keypair
  const keypair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  // Export raw public key (32 bytes)
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey));

  // Export private key as PKCS8 (48 bytes) — last 32 bytes are the raw seed
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keypair.privateKey));
  const rawSeed = pkcs8.slice(pkcs8.length - 32);

  // XRPL Ed25519 public key: 0xED prefix + 32 raw bytes
  const xrplPub = new Uint8Array(33);
  xrplPub[0] = 0xED;
  xrplPub.set(rawPub, 1);

  // Account ID: RIPEMD160(SHA256(xrplPub))
  const pubHash = await sha256(xrplPub);
  const accountId = ripemd160(pubHash);

  // Classic address: Base58Check(0x00 || accountId)
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(accountId, 1);
  const classicAddress = await base58CheckEncode(payload);

  const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();

  return {
    classicAddress,
    publicKey: "ED" + toHex(rawPub),
    privateKey: toHex(rawSeed)
  };
}
