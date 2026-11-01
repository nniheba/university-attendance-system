import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ authenticated: true, ownsClass: true, ownsSession: true }));
const state = vi.hoisted(() => ({ enrollmentStatus: "active" as "active" | "inactive" }));
const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => security.authenticated
    ? { authenticated: true, user: { id: "teacher-a" } }
    : { authenticated: false, response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) },
  teacherOwnsClass: async () => security.ownsClass,
  teacherOwnsSession: async () => security.ownsSession,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { PATCH as updateEnrollment } from "@/app/api/classes/[classId]/students/[enrollmentId]/route";
import { DELETE as removeSession } from "@/app/api/sessions/[id]/route";

const enrollmentContext = { params: Promise.resolve({ classId: "class-a", enrollmentId: "enrollment-a" }) };
const sessionContext = { params: Promise.resolve({ id: "session-a" }) };
const request = (body: Record<string, unknown>, method: "PATCH" | "DELETE") => new Request("https://test.invalid/api", {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  security.authenticated = true;
  security.ownsClass = true;
  security.ownsSession = true;
  state.enrollmentStatus = "active";
  admin.rpc.mockImplementation(async (name: string, args: { p_action?: "deactivate" | "reactivate" }) => {
    if (name === "set_class_enrollment_status" && args.p_action) {
      state.enrollmentStatus = args.p_action === "deactivate" ? "inactive" : "active";
    }
    return { data: "updated-id", error: null };
  });
  admin.from.mockImplementation(() => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "enrollment-a",
          class_id: "class-a",
          student_email: "student.a@students.example.edu",
          student_user_id: null,
          status: state.enrollmentStatus,
          enrolled_at: "2026-09-23T08:00:00Z",
          unenrolled_at: state.enrollmentStatus === "inactive" ? "2026-09-29T10:00:00Z" : null,
          created_by: "teacher-a",
          created_at: "2026-09-23T08:00:00Z",
          updated_at: "2026-09-29T10:00:00Z",
        },
        error: null,
      })),
    };
    return query;
  });
});

describe("attendance matrix enrollment and session actions", () => {
  it.each([
    ["deactivate", "inactive"],
    ["reactivate", "active"],
  ] as const)("uses the canonical %s enrollment transition", async (action, expectedStatus) => {
    state.enrollmentStatus = action === "reactivate" ? "inactive" : "active";
    const response = await updateEnrollment(request({ action }, "PATCH"), enrollmentContext);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("set_class_enrollment_status", {
      p_enrollment_id: "enrollment-a",
      p_action: action,
      p_actor_user_id: "teacher-a",
      p_student_user_id: null,
    });
    expect(await response.json()).toMatchObject({ student: { enrollmentId: "enrollment-a", status: expectedStatus } });
  });

  it("forbids another teacher from changing an enrollment", async () => {
    security.ownsClass = false;
    const response = await updateEnrollment(request({ action: "deactivate" }, "PATCH"), enrollmentContext);
    expect(response.status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("removes a closed matrix session only through the service RPC", async () => {
    const response = await removeSession(request({ reason: "Sesión duplicada" }, "DELETE"), sessionContext);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("remove_attendance_session", {
      p_session_id: "session-a",
      p_reason: "Sesión duplicada",
      p_actor_user_id: "teacher-a",
    });
  });

  it("requires session ownership and a bounded reason", async () => {
    security.ownsSession = false;
    expect((await removeSession(request({ reason: "Motivo" }, "DELETE"), sessionContext)).status).toBe(403);
    security.ownsSession = true;
    expect((await removeSession(request({ reason: "   " }, "DELETE"), sessionContext)).status).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns the safe close-first error for an open session", async () => {
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: "SESSION_STILL_OPEN" } });
    const response = await removeSession(request({ reason: "Sesión equivocada" }, "DELETE"), sessionContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "SESSION_STILL_OPEN",
      message: "Cierra la asistencia antes de eliminar esta sesión.",
    });
  });
});
