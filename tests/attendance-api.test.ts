import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "@/app/api/attendance/register/route";
import { POST as verify } from "@/app/api/attendance/verify/route";
import { createDeviceCookie, deriveDeviceHash, verifyDeviceCookie, DEVICE_COOKIE_NAME } from "@/lib/security/device";
import { createSignedToken, verifySignedToken } from "@/lib/security/token";

const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
const enrollment = vi.hoisted(() => ({ active: true }));
vi.mock("@/lib/academic/enrollments", () => ({
  findActiveEnrollment: async () => enrollment.active ? { id: "enrollment-a" } : null,
}));
const ensureTrusted = vi.hoisted(() => vi.fn());
vi.mock("@/lib/security/trusted-device", () => ({ ensureTrustedStudentDevice: ensureTrusted }));
const auth = vi.hoisted(() => ({ allowed: true, role: "student" as "student" | "teacher" }));
vi.mock("@/lib/security/institutional-auth", () => ({
  requireStudent: async () => auth.allowed && auth.role === "student"
    ? { authenticated: true, user: { id: "student-a", email: "student.a@students.example.edu" }, account: { role: "student" } }
    : { authenticated: false, response: Response.json({ code: auth.allowed ? "FORBIDDEN" : "UNAUTHENTICATED" }, { status: auth.allowed ? 403 : 401 }) },
}));
vi.mock("@/lib/security/student-profile", () => ({
  getStudentProfile: async () => ({ user_id: "student-a", display_name: "Student A", created_at: "now", updated_at: "now" }),
}));
const sessionId = "123e4567-e89b-42d3-a456-426614174000";
let cookie: string;
let hash: string;
let token: string;
let session: { id: string; status: string; latitude: number; longitude: number; allowed_radius_m: number; location_country_code: string; class: { name: string; teacher_name: string } };
let duplicateDevice: boolean;
let duplicateStudent: boolean;

function request(path: string, body: Record<string, unknown>, deviceCookie: string | null = cookie, headers: Record<string, string> = {}) {
  return new Request(`https://test.invalid/api/attendance/${path}`, { method: "POST", headers: { "content-type": "application/json", ...(deviceCookie ? { cookie: `${DEVICE_COOKIE_NAME}=${deviceCookie}` } : {}), ...headers }, body: JSON.stringify(body) });
}
function input(overrides: Record<string, unknown> = {}) {
  return { token, latitude: 0, longitude: 0, accuracy: 10, ...overrides };
}
beforeEach(() => {
  vi.stubEnv("DEVICE_COOKIE_SECRET", "test-device-secret-at-least-32-random-bytes");
  vi.stubEnv("QR_SIGNING_SECRET", "test-qr-secret-at-least-32-random-bytes");
  vi.stubEnv("VERCEL", "");
  vi.clearAllMocks();
  auth.allowed = true;
  auth.role = "student";
  enrollment.active = true;
  cookie = createDeviceCookie();
  hash = deriveDeviceHash(verifyDeviceCookie(cookie)!, sessionId);
  token = createSignedToken(sessionId, "registration", Date.now(), hash);
  session = { id: sessionId, status: "open", latitude: 0, longitude: 0, allowed_radius_m: 100, location_country_code: "ES", class: { name: "Test", teacher_name: "Teacher" } };
  duplicateDevice = false;
  duplicateStudent = false;
  ensureTrusted.mockImplementation(async (incomingRequest: Request) => {
    const raw = incomingRequest.headers.get("cookie")?.split(`${DEVICE_COOKIE_NAME}=`)[1];
    const existingId = verifyDeviceCookie(raw);
    const cookieValue = existingId ? null : createDeviceCookie();
    return {
      trusted: true,
      currentDevice: true,
      enrolled: !existingId,
      code: "TRUSTED_DEVICE",
      deviceId: existingId ?? verifyDeviceCookie(cookieValue ?? undefined)!,
      cookieValue,
    };
  });
  admin.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      is: vi.fn(() => query),
      single: vi.fn(async () => ({ data: table === "sessions" ? session : null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: filters.has("device_hash") ? duplicateDevice ? { id: "existing" } : null : duplicateStudent ? { id: "existing" } : null, error: null })),
    };
    return query;
  });
  admin.rpc.mockResolvedValue({ data: "attendance-id", error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("attendance APIs with signed device identity", () => {
  it("requires an authenticated student for QR verification and registration", async () => {
    auth.allowed = false;
    expect((await verify(request("verify", { token: createSignedToken(sessionId) }))).status).toBe(401);
    expect((await register(request("register", input()))).status).toBe(401);
    auth.allowed = true;
    auth.role = "teacher";
    expect((await verify(request("verify", { token: createSignedToken(sessionId) }))).status).toBe(403);
    expect((await register(request("register", input()))).status).toBe(403);
  });
  it("issues a secure cookie and a matching bound grant after a valid QR", async () => {
    const response = await verify(request("verify", { token: createSignedToken(sessionId) }, null));
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/Secure/iu);
    expect(setCookie).toMatch(/SameSite=lax/iu);
    const issuedCookie = setCookie.split(";")[0].split("=")[1];
    const grant = verifySignedToken((await response.json()).registrationToken, "registration");
    expect(grant.valid).toBe(true);
    if (grant.valid) expect(grant.payload.device_hash).toBe(deriveDeviceHash(verifyDeviceCookie(issuedCookie)!, sessionId));
  });
  it("reuses existing identity rather than rotating it on each scan", async () => {
    const response = await verify(request("verify", { token: createSignedToken(sessionId) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    const grant = verifySignedToken((await response.json()).registrationToken, "registration");
    if (grant.valid) expect(grant.payload.device_hash).toBe(hash);
    else throw new Error("Expected valid grant");
  });
  it("replaces a tampered cookie with a newly signed browser identity", async () => {
    const response = await verify(request("verify", { token: createSignedToken(sessionId) }, "tampered"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/iu);
  });
  it("rejects expired QR and closed sessions before issuing identity", async () => {
    const expired = await verify(request("verify", { token: createSignedToken(sessionId, "qr", Date.now() - 13_000) }, null));
    expect((await expired.json()).code).toBe("TOKEN_EXPIRED");
    session.status = "closed";
    const closed = await verify(request("verify", { token: createSignedToken(sessionId) }, null));
    expect((await closed.json()).code).toBe("SESSION_CLOSED");
    expect(closed.headers.get("set-cookie")).toBeNull();
  });
  it("uses authenticated profile identity and ignores a browser-provided fake name", async () => {
    const response = await register(request("register", input({ fullName: "Forged Name", studentUserId: "forged", deviceId: "forged", qr_verified: false, location_verified: false }), cookie, { "x-forwarded-for": "192.0.2.1" }));
    expect(response.status).toBe(201);
    const args = admin.rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_student_user_id: "student-a", p_device_hash: hash, p_gps_status: "verified", p_distance_from_center_m: 0 });
    const serialized = JSON.stringify(args);
    for (const forbidden of [cookie, verifyDeviceCookie(cookie)!, "latitude", "longitude", "192.0.2.1", "qr_verified", "location_verified", "Forged Name", "p_full_name", "p_normalized_name"]) expect(serialized).not.toContain(forbidden);
    expect((await response.json()).attendance.full_name).toBe("Student A");
  });
  it("ignores a JavaScript identity when HTTP cookie is absent", async () => {
    const response = await register(request("register", input({ deviceId: verifyDeviceCookie(cookie) }), null));
    expect((await response.json()).code).toBe("INVALID_DEVICE_COOKIE");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("rejects a grant replayed in another browser", async () => {
    const response = await register(request("register", input(), createDeviceCookie()));
    expect((await response.json()).code).toBe("INVALID_DEVICE_COOKIE");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid accuracy before inserting", async () => {
    const response = await register(request("register", input({ accuracy: 51 })));
    expect((await response.json()).code).toBe("INSUFFICIENT_ACCURACY");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it("surfaces distinct application-level duplicate errors", async () => {
    duplicateDevice = true;
    expect((await (await register(request("register", input({ fullName: "Juan Pérez" })))).json()).code).toBe("DEVICE_ALREADY_USED");
    duplicateDevice = false;
    duplicateStudent = true;
    expect((await (await register(request("register", input()))).json()).code).toBe("DUPLICATE_ATTENDANCE");
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each(["SESSION_CLOSED", "DEVICE_ALREADY_USED", "DUPLICATE_ATTENDANCE"])("maps a SQL race outcome: %s", async (code) => {
    admin.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: code } });
    const response = await register(request("register", input()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(code);
  });
  it("accepts valid GPS even with a Canadian VPN signal", async () => {
    vi.stubEnv("VERCEL", "1");
    const response = await register(request("register", input(), cookie, { "x-vercel-ip-country": "CA", "x-vercel-ip-city": "Toronto" }));
    expect(response.status).toBe(201);
    expect(admin.rpc.mock.calls[0][1]).toMatchObject({ p_network_country_code: "CA", p_network_city: "Toronto", p_gps_status: "verified" });
  });
});
