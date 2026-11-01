import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/attendance/scan/route";
import { createDeviceCookie, DEVICE_COOKIE_NAME, verifyDeviceCookie } from "@/lib/security/device";
import { createAttendanceQrToken } from "@/lib/security/attendance-qr-token";
import { createSignedToken } from "@/lib/security/token";

const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
const enrollment = vi.hoisted(() => ({ status: "active" as "active" | "inactive" | null }));
vi.mock("@/lib/academic/enrollments", () => ({
  findStudentEnrollment: async () => enrollment.status ? { id: "enrollment-a", status: enrollment.status } : null,
}));
const ensureTrusted = vi.hoisted(() => vi.fn());
vi.mock("@/lib/security/trusted-device", () => ({ ensureTrustedStudentDevice: ensureTrusted }));

const auth = vi.hoisted(() => ({ allowed: true, role: "student" as "student" | "teacher", userId: "student-a" }));
vi.mock("@/lib/security/institutional-auth", () => ({
  requireStudent: async () => auth.allowed && auth.role === "student"
    ? { authenticated: true, user: { id: auth.userId, email: "student.a@students.example.edu" }, account: { role: "student", email: "student.a@students.example.edu" } }
    : { authenticated: false, response: Response.json({ code: auth.allowed ? "FORBIDDEN" : "UNAUTHENTICATED" }, { status: auth.allowed ? 403 : 401 }) },
}));
vi.mock("@/lib/security/student-profile", () => ({
  getStudentProfile: async () => ({ user_id: auth.userId, display_name: "Student A", created_at: "now", updated_at: "now" }),
}));

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const secondSessionId = "123e4567-e89b-42d3-a456-426614174099";
let session: {
  id: string;
  class_id: string;
  status: string;
  allow_self_enrollment: boolean;
  class: { id: string; name: string; teacher_name: string; status: "active" | "archived" } | null;
} | null;
let existingStudent: { id: string; full_name: string; registered_at: string } | null;
let existingDevice: { id: string } | null;

function request(token: string, cookie: string | null = null) {
  return new Request("https://test.invalid/api/attendance/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${DEVICE_COOKIE_NAME}=${cookie}` } : {}),
    },
    body: JSON.stringify({ token }),
  });
}

beforeEach(() => {
  vi.stubEnv("DEVICE_COOKIE_SECRET", "test-device-secret-at-least-32-random-bytes");
  vi.stubEnv("QR_SIGNING_SECRET", "test-qr-secret-at-least-32-random-bytes");
  vi.stubEnv("VERCEL", "");
  vi.clearAllMocks();
  auth.allowed = true;
  auth.role = "student";
  auth.userId = "student-a";
  enrollment.status = "active";
  session = {
    id: sessionId,
    class_id: "class-1",
    status: "open",
    allow_self_enrollment: false,
    class: { id: "class-1", name: "Informática", teacher_name: "Teacher", status: "active" },
  };
  existingStudent = null;
  existingDevice = null;
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
      single: vi.fn(async () => ({
        data: table === "sessions" ? session : existingStudent,
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({
        data: filters.has("student_user_id") ? existingStudent : existingDevice,
        error: null,
      })),
    };
    return query;
  });
  admin.rpc.mockImplementation(async (name: string) => ({ data: name === "self_enroll_student_for_session" ? true : "attendance-id", error: null }));
});

afterEach(() => vi.unstubAllEnvs());

describe("single-step attendance scanner API", () => {
  it("requires an authenticated student", async () => {
    auth.allowed = false;
    expect((await POST(request(createAttendanceQrToken(sessionId)))).status).toBe(401);
    auth.allowed = true;
    auth.role = "teacher";
    expect((await POST(request(createAttendanceQrToken(sessionId)))).status).toBe(403);
  });

  it("registers a current compact QR without coordinates and establishes the device cookie", async () => {
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/iu);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "registered",
      session: { id: sessionId },
      class: { id: "class-1", name: "Informática", teacher_name: "Teacher" },
    });
    const args = admin.rpc.mock.calls[0][1];
    expect(args).toMatchObject({ p_session_id: sessionId, p_student_user_id: "student-a" });
    for (const forbidden of ["latitude", "longitude", "location_verified", "qr_verified", "full_name"]) {
      expect(JSON.stringify(args)).not.toContain(forbidden);
    }
  });

  it("replaces an invalid device cookie during the first successful scan", async () => {
    const response = await POST(request(createAttendanceQrToken(sessionId), "invalid-cookie"));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${DEVICE_COOKIE_NAME}=v1\\.`));
  });

  it("rejects expired, tampered and closed-session QR codes", async () => {
    const expired = await POST(request(createAttendanceQrToken(sessionId, Date.now() - 5_000)));
    expect((await expired.json()).code).toBe("TOKEN_EXPIRED");

    const current = createAttendanceQrToken(sessionId);
    const segments = current.split(".");
    segments[3] = `${segments[3][0] === "A" ? "B" : "A"}${segments[3].slice(1)}`;
    const tampered = await POST(request(segments.join(".")));
    expect((await tampered.json()).code).toBe("INVALID_TOKEN");

    session!.status = "closed";
    const closed = await POST(request(createAttendanceQrToken(sessionId)));
    expect((await closed.json()).code).toBe("SESSION_CLOSED");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a signed session that does not exist", async () => {
    session = null;
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN", message: "Código de clase no válido." });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a valid QR when the authenticated student is not actively enrolled", async () => {
    enrollment.status = null;
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "STUDENT_NOT_ENROLLED", message: "No estás matriculado en esta asignatura." });
    expect(ensureTrusted).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("self-enrolls after a valid QR and trusted-device check when the session permits it", async () => {
    enrollment.status = null;
    session!.allow_self_enrollment = true;
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, status: "registered", enrolled: true });
    expect(ensureTrusted).toHaveBeenCalledOnce();
    expect(admin.rpc.mock.calls.map(([name]) => name)).toEqual([
      "self_enroll_student_for_session",
      "register_attendance_if_open",
    ]);
    expect(admin.rpc.mock.calls[0][1]).toEqual({
      p_session_id: sessionId,
      p_student_user_id: "student-a",
      p_student_email: "student.a@students.example.edu",
    });
  });

  it("rejects inactive enrollment without trusting the device or invoking an RPC", async () => {
    enrollment.status = "inactive";
    session!.allow_self_enrollment = true;
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ENROLLMENT_INACTIVE" });
    expect(ensureTrusted).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("does not register when the session class relationship is missing", async () => {
    session!.class = null;
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "CLASS_NOT_FOUND", message: "No pudimos identificar la clase." });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("keeps accepting a legacy signed QR during the QA transition", async () => {
    const response = await POST(request(createSignedToken(sessionId)));
    expect(response.status).toBe(201);
  });

  it("returns an informational success for the same student", async () => {
    existingStudent = { id: "existing", full_name: "Student A", registered_at: "2026-09-22T18:31:00.000Z" };
    const response = await POST(request(createAttendanceQrToken(sessionId)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "already_registered", attendance: { id: "existing" } });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("prevents a different student from reusing the same device and session", async () => {
    existingDevice = { id: "student-a-attendance" };
    auth.userId = "student-b";
    const response = await POST(request(createAttendanceQrToken(sessionId), createDeviceCookie()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEVICE_ALREADY_USED");
  });

  it.each([
    ["ACCOUNT_DEVICE_MISMATCH", "Esta cuenta está vinculada a otro dispositivo."],
    ["DEVICE_BOUND_TO_OTHER_ACCOUNT", "Este dispositivo ya está vinculado a otra cuenta."],
  ])("preserves the trusted-device rejection %s", async (code, message) => {
    ensureTrusted.mockResolvedValueOnce({
      trusted: false,
      currentDevice: false,
      enrolled: false,
      code,
      deviceId: "",
      cookieValue: null,
    });
    const response = await POST(request(createAttendanceQrToken(sessionId), createDeviceCookie()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code, message });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("allows the same student to register in another session", async () => {
    session = { ...session!, id: secondSessionId };
    const response = await POST(request(createAttendanceQrToken(secondSessionId), createDeviceCookie()));
    expect(response.status).toBe(201);
    expect(admin.rpc.mock.calls[0][1].p_session_id).toBe(secondSessionId);
  });

  it("maps atomic database race outcomes safely", async () => {
    admin.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "DEVICE_ALREADY_USED" } });
    const response = await POST(request(createAttendanceQrToken(sessionId), createDeviceCookie()));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DEVICE_ALREADY_USED");
  });
});
