import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceCookie, verifyDeviceCookie, deriveDeviceHash, deviceCookieOptions, DEVICE_COOKIE_MAX_AGE_S } from "@/lib/security/device";

const NOW = 1800000000000;
beforeEach(() => vi.stubEnv("DEVICE_COOKIE_SECRET", "unit-test-device-secret-with-at-least-32-bytes"));
afterEach(() => vi.unstubAllEnvs());

describe("signed device identity", () => {
  it("accepts a server-issued cookie containing 32 random bytes", () => {
    const cookie = createDeviceCookie(NOW);
    expect(verifyDeviceCookie(cookie, NOW)).toMatch(/^[a-f0-9]{64}$/u);
    expect(createDeviceCookie(NOW)).not.toBe(cookie);
  });
  it("rejects changed identity, signature, missing and malformed cookies", () => {
    const cookie = createDeviceCookie(NOW);
    const pieces = cookie.split(".");
    pieces[1] = "0".repeat(64);
    expect(verifyDeviceCookie(pieces.join("."), NOW)).toBeNull();
    expect(verifyDeviceCookie(cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0"), NOW)).toBeNull();
    expect(verifyDeviceCookie(undefined, NOW)).toBeNull();
    expect(verifyDeviceCookie("client-device-id", NOW)).toBeNull();
  });
  it("rejects expired and future cookies", () => {
    const cookie = createDeviceCookie(NOW);
    expect(verifyDeviceCookie(cookie, NOW + DEVICE_COOKIE_MAX_AGE_S * 1000)).toBeNull();
    expect(verifyDeviceCookie(cookie, NOW - 1000)).toBeNull();
  });
  it("derives stable session-scoped hashes, not raw IDs", () => {
    const id = verifyDeviceCookie(createDeviceCookie(NOW), NOW)!;
    const hash = deriveDeviceHash(id, "session-a");
    expect(hash).not.toBe(id);
    expect(hash).toBe(deriveDeviceHash(id, "session-a"));
    expect(hash).not.toBe(deriveDeviceHash(id, "session-b"));
  });
  it("uses HttpOnly, SameSite Lax, path /, 180 days and production Secure", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(deviceCookieOptions("https://test.invalid")).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 15552000 });
    vi.stubEnv("NODE_ENV", "development");
    expect(deviceCookieOptions("http://localhost:3000").secure).toBe(false);
    expect(deviceCookieOptions("https://test.invalid").secure).toBe(true);
  });
  it("fails closed without a strong server secret", () => {
    vi.stubEnv("DEVICE_COOKIE_SECRET", "short");
    expect(() => createDeviceCookie()).toThrow("32 bytes");
  });
});
