// RedeemCodes — secret gift / promo codes.
//
// HOW THE SECRECY WORKS
// ---------------------
// Codes are NEVER stored in plain text anywhere in the game. This file only
// contains SHA-256 digests of the normalized code strings, so the actual
// code cannot be read out of the source or the shipped bundle. When a player
// types a code, we normalize it (trim, lower-case, strip spaces), hash it,
// and compare the digest against the table below.
//
// ADDING A NEW SECRET CODE
// ------------------------
// Pick a code, then run this in a terminal:
//   node -e "const s=require('crypto').createHash('sha256');s.update('YOURCODE'.trim().toLowerCase());console.log(s.digest('hex'))"
// and append `{ hash: '<digest>', label: '…', credits: N }` to REDEEM_CODES.
// Tell the code only to the players who should have it.

// SHA-256 round constants (fractional 32 bits of the cube roots of the first
// 64 primes) — the standard published table.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** Compact synchronous SHA-256 → lowercase hex digest. */
export function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const l = bytes.length;
  const total = (((l + 1 + 8) + 63) >> 6) << 6; // padded message length
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(l / 536870912)); // bit length, high 32 bits
  dv.setUint32(total - 4, (l * 8) >>> 0);             // bit length, low 32 bits

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
  return out;
}

/** Canonical form a code is matched in: trimmed, lower-cased, no spaces. */
export function normalizeCode(raw) {
  return String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

// The secret code table — digests only, never plain codes.
//   { hash: SHA-256 of the normalized code, label, credits }
export const REDEEM_CODES = [
  {
    hash: 'b3282a2f2a28757b3a18ab833de16a9c54518c0b0cf493e3f0a7cf09386f326a',
    label: 'SECRET GIFT',
    credits: 1000000000000 // +1,000,000,000,000 CR — one trillion credits
  }
];

/**
 * Look up a player-typed code.
 * @returns the matching REDEEM_CODES entry, or null when nothing matches.
 */
export function lookupRedeemCode(raw) {
  const norm = normalizeCode(raw);
  if (!norm) return null;
  const digest = sha256Hex(norm);
  return REDEEM_CODES.find((c) => c.hash === digest) || null;
}
