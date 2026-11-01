import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({
  authenticated: false,
  denialStatus: 401,
  ownsClass: false,
  ownsSession: false,
  user: { id: "teacher-a", email: "teacher-a@example.test", user_metadata: {} },
}));
const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => security.authenticated
    ? { authenticated: true, user: security.user }
    : { authenticated: false, response: Response.json({ code: security.denialStatus === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: security.denialStatus }) },
  teacherOwnsClass: async () => security.ownsClass,
  teacherOwnsSession: async () => security.ownsSession,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/security/teacher-profile", () => ({
  getOrCreateTeacherProfile: async () => ({
    user_id: "teacher-a",
    display_name: "Teacher A",
    avatar_key: "avatar_01",
    created_at: "now",
    updated_at: "now",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/academic/teacher-statistics", () => ({
  getTeacherClassSummaries: async (classes: Array<Record<string, unknown>>) => classes.map((course) => ({
    ...course,
    student_count: 2,
    session_count: 3,
    closed_session_count: 2,
    average_attendance_percentage: 75,
  })),
}));
import { POST as createClass } from "@/app/api/classes/route";
import { GET as readClass } from "@/app/api/classes/[classId]/route";
import { POST as createSession } from "@/app/api/sessions/route";
import { GET as readSession, PATCH as closeSession } from "@/app/api/sessions/[id]/route";
import { GET as requestQr } from "@/app/api/sessions/[id]/qr/route";
import { GET as exportCsv } from "@/app/api/sessions/[id]/export/route";
import { verifyAttendanceQrToken } from "@/lib/security/attendance-qr-token";
import { parseAttendanceQrValue } from "@/lib/qr/attendance-value";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const context = { params: Promise.resolve({ id: sessionId }) };
const classContext = { params: Promise.resolve({ classId: sessionId }) };

function jsonRequest(url: string, body: Record<string, unknown>, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("QR_SIGNING_SECRET", "test-qr-secret-at-least-32-random-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.clearAllMocks();
  security.authenticated = false;
  security.denialStatus = 401;
  security.ownsClass = false;
  security.ownsSession = false;
});

afterEach(() => vi.unstubAllEnvs());

describe("teacher API authorization", () => {
  it("rejects anonymous class creation with 401", async () => {
    const response = await createClass(jsonRequest("https://test.invalid/api/classes", { name: "Security" }));
    expect(response.status).toBe(401);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects student access to teacher class APIs", async () => {
    security.denialStatus = 403;
    const response = await createClass(jsonRequest("https://test.invalid/api/classes", { name: "Security" }));
    expect(response.status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("assigns a new class to the authenticated teacher and ignores browser ownership", async () => {
    security.authenticated = true;
    const single = vi.fn(async () => ({
      data: { id: "class-a", name: "Security", teacher_name: "Teacher A", teacher_id: "teacher-a", created_at: "now" },
      error: null,
    }));
    const query = { insert: vi.fn(), select: vi.fn(), single };
    query.insert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    admin.from.mockReturnValue(query);

    const response = await createClass(jsonRequest("https://test.invalid/api/classes", {
      name: "Security",
      teacherId: "teacher-b",
      teacherName: "Forged",
      enrollmentMode: "closed",
      colorKey: "purple",
    }));
    expect(response.status).toBe(201);
    expect(query.insert).toHaveBeenCalledWith({
      name: "Security",
      teacher_name: "Teacher A",
      teacher_id: "teacher-a",
      group_name: null,
      academic_year: null,
      enrollment_mode: "closed",
      color_key: "purple",
      status: "active",
    });
  });

  it("returns 403 when another teacher attempts to create a session for a foreign class", async () => {
    security.authenticated = true;
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    admin.from.mockReturnValue(query);
    const response = await createSession(jsonRequest("https://test.invalid/api/sessions", {
      classId: sessionId,
      sessionName: "Seguridad",
      colorKey: "blue",
      allowSelfEnrollment: false,
    }));
    expect(response.status).toBe(403);
    expect(admin.from).toHaveBeenCalledWith("classes");
  });

  it("prevents a different teacher from reading a private class roster context", async () => {
    security.authenticated = true;
    security.ownsClass = false;
    const response = await readClass(new Request(`https://test.invalid/api/classes/${sessionId}`), classContext);
    expect(response.status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("allows the owning teacher to read the class summary", async () => {
    security.authenticated = true;
    security.ownsClass = true;
    const course = { id: sessionId, name: "Security", teacher_id: "teacher-a", status: "active" };
    admin.from.mockImplementation((table: string) => {
      const count = table === "class_enrollments" ? 2 : 3;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: course, error: null })),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ count, error: null })),
      };
      return query;
    });
    const response = await readClass(new Request(`https://test.invalid/api/classes/${sessionId}`), classContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ class: { id: sessionId, student_count: 2, session_count: 3 } });
  });

  it("creates an owned session without browser location data", async () => {
    security.authenticated = true;
    security.ownsClass = true;
    const classQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { id: sessionId, status: "active" }, error: null })) };
    classQuery.select.mockReturnValue(classQuery);
    classQuery.eq.mockReturnValue(classQuery);
    const single = vi.fn(async () => ({ data: { id: sessionId, class_id: sessionId, status: "open", latitude: null, longitude: null, allowed_radius_m: null }, error: null }));
    const sessionQuery = { insert: vi.fn(), select: vi.fn(), single };
    sessionQuery.insert.mockReturnValue(sessionQuery);
    sessionQuery.select.mockReturnValue(sessionQuery);
    admin.from.mockImplementation((table: string) => table === "classes" ? classQuery : sessionQuery);

    const response = await createSession(jsonRequest("https://test.invalid/api/sessions", {
      classId: sessionId,
      latitude: 90,
      longitude: 180,
      allowedRadiusM: 5000,
      sessionName: "Introducción a Docker",
      colorKey: "cyan",
      allowSelfEnrollment: true,
    }));
    expect(response.status).toBe(201);
    expect(sessionQuery.insert).toHaveBeenCalledWith({
      class_id: sessionId,
      session_name: "Introducción a Docker",
      color_key: "cyan",
      status: "open",
      latitude: null,
      longitude: null,
      allowed_radius_m: null,
      allow_self_enrollment: true,
      enable_projection_bubbles: true,
    });
  });

  it("persists an explicit disabled projection animation preference", async () => {
    security.authenticated = true;
    security.ownsClass = true;
    const classQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: { id: sessionId, status: "active" }, error: null })) };
    classQuery.select.mockReturnValue(classQuery);
    classQuery.eq.mockReturnValue(classQuery);
    const sessionQuery = { insert: vi.fn(), select: vi.fn(), single: vi.fn(async () => ({ data: { id: sessionId }, error: null })) };
    sessionQuery.insert.mockReturnValue(sessionQuery);
    sessionQuery.select.mockReturnValue(sessionQuery);
    admin.from.mockImplementation((table: string) => table === "classes" ? classQuery : sessionQuery);

    const response = await createSession(jsonRequest("https://test.invalid/api/sessions", {
      classId: sessionId,
      sessionName: "Proyección sobria",
      colorKey: "blue",
      allowSelfEnrollment: false,
      enableProjectionBubbles: false,
    }));

    expect(response.status).toBe(201);
    expect(sessionQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      enable_projection_bubbles: false,
    }));
  });

  it("rejects unknown class enrollment modes and non-boolean session policy", async () => {
    security.authenticated = true;
    expect((await createClass(jsonRequest("https://test.invalid/api/classes", { name: "Security", enrollmentMode: "public" }))).status).toBe(400);
    expect((await createSession(jsonRequest("https://test.invalid/api/sessions", { classId: sessionId, allowSelfEnrollment: "yes" }))).status).toBe(400);
    expect((await createSession(jsonRequest("https://test.invalid/api/sessions", { classId: sessionId, allowSelfEnrollment: true, enableProjectionBubbles: "yes" }))).status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects arbitrary colors and invalid session names before database access", async () => {
    security.authenticated = true;
    expect((await createClass(jsonRequest("https://test.invalid/api/classes", {
      name: "Security",
      enrollmentMode: "closed",
      colorKey: "#ff00ff",
    }))).status).toBe(400);
    expect((await createSession(jsonRequest("https://test.invalid/api/sessions", {
      classId: sessionId,
      sessionName: "x".repeat(121),
      colorKey: "blue",
      allowSelfEnrollment: false,
    }))).status).toBe(400);
    expect((await createSession(jsonRequest("https://test.invalid/api/sessions", {
      classId: sessionId,
      sessionName: "Docker",
      colorKey: "orange",
      allowSelfEnrollment: false,
    }))).status).toBe(400);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it.each([
    ["read", () => readSession(new Request(`https://test.invalid/api/sessions/${sessionId}`), context)],
    ["QR", () => requestQr(new Request(`https://test.invalid/api/sessions/${sessionId}/qr`), context)],
    ["close", () => closeSession(jsonRequest(`https://test.invalid/api/sessions/${sessionId}`, { action: "close" }, "PATCH"), context)],
    ["metadata update", () => closeSession(jsonRequest(`https://test.invalid/api/sessions/${sessionId}`, { action: "update_details", sessionName: "Edited", openedAt: "2026-09-24T16:30:00.000Z", colorKey: "green" }, "PATCH"), context)],
    ["export", () => exportCsv(new Request(`https://test.invalid/api/sessions/${sessionId}/export`), context)],
  ])("returns 403 when Teacher B attempts Teacher A %s", async (_name, action) => {
    security.authenticated = true;
    security.ownsSession = false;
    const response = await action();
    expect(response.status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("updates owned session metadata only through the atomic RPC", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    admin.rpc.mockResolvedValue({
      data: [{ session_id: sessionId, session_name: "Docker revisado", opened_at: "2026-09-24T16:30:00.000Z", color_key: "green" }],
      error: null,
    });

    const response = await closeSession(jsonRequest(`https://test.invalid/api/sessions/${sessionId}`, {
      action: "update_details",
      sessionName: "  Docker revisado  ",
      openedAt: "2026-09-24T16:30:00.000Z",
      colorKey: "green",
      enableProjectionBubbles: false,
      classId: "forged-class",
    }, "PATCH"), context);

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("update_session_details_with_projection", {
      p_session_id: sessionId,
      p_session_name: "Docker revisado",
      p_opened_at: "2026-09-24T16:30:00.000Z",
      p_color_key: "green",
      p_enable_projection_bubbles: false,
      p_actor_user_id: "teacher-a",
    });
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toContain("forged-class");
  });

  it("rejects invalid session metadata before calling the database", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    const invalidBodies = [
      { action: "update_details", sessionName: "   ", openedAt: "2026-09-24T16:30:00.000Z", colorKey: "blue" },
      { action: "update_details", sessionName: "Valid", openedAt: "not-a-date", colorKey: "blue" },
      { action: "update_details", sessionName: "Valid", openedAt: "0", colorKey: "blue" },
      { action: "update_details", sessionName: "Valid", openedAt: "2026-09-24T16:30:00.000Z", colorKey: "orange" },
      { action: "update_details", sessionName: "Valid", openedAt: "2026-09-24T16:30:00.000Z", colorKey: "blue", enableProjectionBubbles: "yes" },
    ];
    for (const body of invalidBodies) {
      const response = await closeSession(jsonRequest(`https://test.invalid/api/sessions/${sessionId}`, body, "PATCH"), context);
      expect(response.status).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns a safe time-range error from the metadata RPC", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    admin.rpc.mockResolvedValue({ data: null, error: { message: "INVALID_SESSION_TIME_RANGE" } });
    const response = await closeSession(jsonRequest(`https://test.invalid/api/sessions/${sessionId}`, {
      action: "update_details",
      sessionName: "Valid",
      openedAt: "2026-09-24T19:30:00.000Z",
      colorKey: "blue",
    }, "PATCH"), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "INVALID_SESSION_TIME_RANGE" });
  });

  it("returns 401 to an anonymous QR request", async () => {
    const response = await requestQr(new Request(`https://test.invalid/api/sessions/${sessionId}/qr`), context);
    expect(response.status).toBe(401);
  });

  it("returns one absolute attendance URL to the owning teacher", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      single: vi.fn(async () => ({ data: { id: sessionId, status: "open" }, error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    admin.from.mockReturnValue(query);

    const response = await requestQr(new Request(`https://preview.example/api/sessions/${sessionId}/qr`), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.value).toMatch(/^https:\/\/preview\.example\/attendance\/q2\./u);
    expect(body).not.toHaveProperty("url");
    expect(body).not.toHaveProperty("token");
    const parsed = parseAttendanceQrValue(body.value, { trustedOrigins: ["https://preview.example"] });
    expect(parsed).not.toBeNull();
    expect(verifyAttendanceQrToken(parsed!.token).valid).toBe(true);
  });

  it("returns 401 to an anonymous CSV export request", async () => {
    const response = await exportCsv(new Request(`https://test.invalid/api/sessions/${sessionId}/export`), context);
    expect(response.status).toBe(401);
  });
});
