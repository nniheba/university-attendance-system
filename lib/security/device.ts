import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DEVICE_COOKIE_NAME = "attendance_device_v1";
export const DEVICE_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.DEVICE_COOKIE_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("DEVICE_COOKIE_SECRET requiere al menos 32 bytes aleatorios.");
  }
  return value;
}

function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function createDeviceCookie(now = Date.now()): string {
  const payload = `v1.${randomBytes(32).toString("hex")}.${Math.floor(now / 1000)}`;
  return `${payload}.${hmac(`cookie:${payload}`)}`;
}

export function verifyDeviceCookie(value: string | undefined, now = Date.now()): string | null {
  if (!value || !/^v1\.[a-f0-9]{64}\.[0-9]{10}\.[a-f0-9]{64}$/u.test(value)) return null;
  const [version, id, issued, signature] = value.split(".");
  const expected = hmac(`cookie:${version}.${id}.${issued}`);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) return null;
  const age = Math.floor(now / 1000) - Number(issued);
  if (age < 0 || age >= DEVICE_COOKIE_MAX_AGE_S) return null;
  return id;
}

// Session-scoping avoids a persistent cross-session tracking key in attendance.
export function deriveDeviceHash(deviceId: string, sessionId: string): string {
  return hmac(`attendance:${sessionId}:${deviceId}`);
}

// Stable only inside this application. The raw signed-cookie identifier never
// leaves the server and is not stored in the database.
export function deriveTrustedDeviceHash(deviceId: string): string {
  return hmac(`trusted-device:${deviceId}`);
}

export function deviceCookieOptions(requestUrl: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production" || new URL(requestUrl).protocol === "https:",
    maxAge: DEVICE_COOKIE_MAX_AGE_S,
  };
}
