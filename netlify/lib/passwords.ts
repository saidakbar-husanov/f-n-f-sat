// netlify/lib/passwords.ts — password hashing shared by sign-in and admin resets.
// Storage format: "scrypt$<salt hex>$<hash hex>" with a per-password random salt.
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// A strong, readable temporary password: 14 characters drawn uniformly from an
// alphabet without look-alikes, always containing upper, lower and a digit.
export function temporaryPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", digits = "23456789";
  const all = upper + lower + digits + "-_";
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

export function passwordProblem(pw: string) {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 200) return "Use at most 200 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use at least one letter and one number.";
  return null;
}
