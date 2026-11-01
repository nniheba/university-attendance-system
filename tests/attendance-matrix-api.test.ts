import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ authenticated: true, owns: true }));
const services = vi.hoisted(() => ({ matrix: vi.fn() }));
const admin = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => security.authenticated
    ? { authenticated: true, user: { id: "teacher-a" } }
    : { authenticated: false, response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) },
  teacherOwnsClass: async () => security.owns,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/academic/attendance-matrix", () => ({ getTeacherAttendanceMatrix: services.matrix }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { GET, PATCH } from "@/app/api/classes/[classId]/attendance-matrix/route";

const context = { params: Promise.resolve({ classId: "class-a" }) };
const matrix = { class: { id: "class-a", name: "Programming" }, sessions: [], rows: [] };
const sessionId = "123e4567-e89b-42d3-a456-426614174401";
const enrollmentId = "123e4567-e89b-42d3-a456-426614174402";
const request = (body: Record<string, unknown>) => new Request("https://test.invalid/api", { method: "PATCH", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  security.authenticated = true;
  security.owns = true;
  services.matrix.mockResolvedValue(matrix);
  admin.rpc.mockResolvedValue({ data: "override-a", error: null });
});

describe("teacher attendance matrix API", () => {
  it("requires a teacher and class ownership", async () => {
    security.authenticated = false;
    expect((await GET(new Request("https://test.invalid"), context)).status).toBe(401);
    security.authenticated = true;
    security.owns = false;
    expect((await GET(new Request("https://test.invalid"), context)).status).toBe(403);
    expect(services.matrix).not.toHaveBeenCalled();
  });

  it("writes only through the atomic service RPC with authenticated actor identity", async () => {
    const response = await PATCH(request({ action: "set_status", sessionId, enrollmentId, status: "present", reason: "Fallo de QR" }), context);
    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("set_attendance_override", expect.objectContaining({ p_actor_user_id: "teacher-a", p_class_id: "class-a", p_status: "present" }));
  });

  it("requires a reason and returns safe cross-class and N/A errors", async () => {
    expect((await PATCH(request({ action: "set_status", sessionId, enrollmentId, status: "present", reason: "" }), context)).status).toBe(400);
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: "INVALID_OVERRIDE_RELATION" } });
    expect(await (await PATCH(request({ action: "set_status", sessionId, enrollmentId, status: "present", reason: "Cruce" }), context)).json()).toMatchObject({ code: "INVALID_OVERRIDE_RELATION" });
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: "SESSION_NOT_ELIGIBLE_FOR_STUDENT" } });
    expect(await (await PATCH(request({ action: "set_status", sessionId, enrollmentId, status: "present", reason: "No aplica" }), context)).json()).toMatchObject({ code: "SESSION_NOT_ELIGIBLE_FOR_STUDENT" });
  });
});
