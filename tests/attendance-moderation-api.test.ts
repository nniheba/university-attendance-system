import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ authenticated: true, owns: true }));
const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => security.authenticated
    ? { authenticated: true, user: { id: "teacher-a" } }
    : { authenticated: false, response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) },
  teacherOwnsSession: async () => security.owns,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { POST as addManual } from "@/app/api/sessions/[id]/attendance/manual/route";
import { PATCH as moderate } from "@/app/api/sessions/[id]/attendance/[attendanceId]/route";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const attendanceId = "123e4567-e89b-42d3-a456-426614174001";
const manualContext = { params: Promise.resolve({ id: sessionId }) };
const moderationContext = { params: Promise.resolve({ id: sessionId, attendanceId }) };

function request(body: Record<string, unknown>, method = "POST") {
  return new Request("https://test.invalid/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  security.authenticated = true;
  security.owns = true;
  admin.rpc.mockResolvedValue({ data: attendanceId, error: null });
  admin.from.mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      is: vi.fn(() => query),
      update: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: table === "class_enrollments"
          ? { id: "enrollment-a", student_user_id: null }
          : null,
        error: null,
      })),
      single: vi.fn(async () => ({
        data: table === "sessions"
          ? { class_id: "class-a" }
          : table === "attendance"
            ? { id: attendanceId, session_id: sessionId }
            : null,
        error: null,
      })),
    };
    return query;
  });
});

describe("teacher attendance moderation APIs", () => {
  it("requires authentication and ownership", async () => {
    security.authenticated = false;
    expect((await addManual(request({ email: "a@students.example.edu", reason: "Motivo" }), manualContext)).status).toBe(401);
    security.authenticated = true;
    security.owns = false;
    expect((await moderate(request({ action: "void", reason: "Error" }, "PATCH"), moderationContext)).status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("derives the name for a student without an account and writes through the atomic RPC", async () => {
    const response = await addManual(request({
      email: "student.one@students.example.edu",
      reason: "Incidencia de acceso",
    }), manualContext);
    expect(response.status).toBe(201);
    const sessionQuery = admin.from.mock.results[0]?.value as { is: ReturnType<typeof vi.fn> };
    const enrollmentQuery = admin.from.mock.results[1]?.value as { is: ReturnType<typeof vi.fn> };
    expect(sessionQuery.is).toHaveBeenCalledWith("deleted_at", null);
    expect(enrollmentQuery.is).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("add_manual_attendance", expect.objectContaining({
      p_student_user_id: null,
      p_student_email: "student.one@students.example.edu",
      p_full_name: "Student One",
      p_actor_user_id: "teacher-a",
    }));
  });

  it("accepts only explicit moderation actions and requires a void reason", async () => {
    expect((await moderate(request({ action: "delete" }, "PATCH"), moderationContext)).status).toBe(400);
    expect((await moderate(request({ action: "void", reason: "" }, "PATCH"), moderationContext)).status).toBe(400);
    const response = await moderate(request({ action: "mark_suspicious", reason: "Revisar" }, "PATCH"), moderationContext);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("moderate_attendance", expect.objectContaining({
      p_action: "mark_suspicious",
      p_value: "Revisar",
      p_actor_user_id: "teacher-a",
    }));
  });
});
