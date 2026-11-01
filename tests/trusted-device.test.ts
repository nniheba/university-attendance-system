import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => new Map<string, string>());
const admin = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import {
  createDeviceCookie,
  deriveTrustedDeviceHash,
  DEVICE_COOKIE_NAME,
  verifyDeviceCookie,
} from "@/lib/security/device";
import { ensureTrustedStudentDevice } from "@/lib/security/trusted-device";

function request(cookie?: string) {
  return new Request("https://test.invalid/api/student/device", {
    headers: cookie ? { cookie: `${DEVICE_COOKIE_NAME}=${cookie}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("DEVICE_COOKIE_SECRET", "trusted-device-test-secret-at-least-32-bytes");
  bindings.clear();
  admin.from.mockImplementation(() => {
    const filters = new Map<string, string>();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: string) => { filters.set(key, value); return query; }),
      maybeSingle: vi.fn(async () => {
        const requestedUser = filters.get("user_id");
        const requestedHash = filters.get("device_hash");
        if (requestedUser) {
          const hash = bindings.get(requestedUser);
          return { data: hash ? { user_id: requestedUser, device_hash: hash } : null, error: null };
        }
        if (requestedHash) {
          const entry = [...bindings.entries()].find(([, hash]) => hash === requestedHash);
          return { data: entry ? { user_id: entry[0], device_hash: entry[1] } : null, error: null };
        }
        return { data: null, error: null };
      }),
      insert: vi.fn(async (row: { user_id: string; device_hash: string }) => {
        if (bindings.has(row.user_id) || [...bindings.values()].includes(row.device_hash)) {
          return { error: { code: "23505" } };
        }
        bindings.set(row.user_id, row.device_hash);
        return { error: null };
      }),
    };
    return query;
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("trusted browser binding", () => {
  it("automatically binds the first signed browser cookie without OTP", async () => {
    const result = await ensureTrustedStudentDevice(request(), "student-a");
    expect(result).toMatchObject({ trusted: true, currentDevice: true, enrolled: true });
    expect(result.cookieValue).toMatch(/^v1\./u);
    expect(bindings.get("student-a")).toBe(deriveTrustedDeviceHash(result.deviceId));
  });

  it("accepts the same account and browser", async () => {
    const cookie = createDeviceCookie();
    const deviceId = verifyDeviceCookie(cookie)!;
    bindings.set("student-a", deriveTrustedDeviceHash(deviceId));
    await expect(ensureTrustedStudentDevice(request(cookie), "student-a")).resolves.toMatchObject({
      trusted: true,
      enrolled: false,
      cookieValue: null,
    });
  });

  it("does not move an account to a new browser automatically", async () => {
    bindings.set("student-a", deriveTrustedDeviceHash("a".repeat(64)));
    await expect(ensureTrustedStudentDevice(request(createDeviceCookie()), "student-a")).resolves.toMatchObject({
      trusted: false,
      code: "ACCOUNT_DEVICE_MISMATCH",
    });
  });

  it("does not bind the same browser to another account", async () => {
    const cookie = createDeviceCookie();
    const deviceId = verifyDeviceCookie(cookie)!;
    bindings.set("student-a", deriveTrustedDeviceHash(deviceId));
    await expect(ensureTrustedStudentDevice(request(cookie), "student-b")).resolves.toMatchObject({
      trusted: false,
      code: "DEVICE_BOUND_TO_OTHER_ACCOUNT",
    });
  });
});
