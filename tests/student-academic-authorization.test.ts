import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  authenticated: false,
  denialStatus: 401,
  userId: "student-a",
  email: "student.a@students.example.edu",
}));

const services = vi.hoisted(() => ({
  summary: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/lib/security/institutional-auth", () => ({
  requireStudent: async () => auth.authenticated
    ? { authenticated: true, user: { id: auth.userId }, account: { email: auth.email, role: "student" } }
    : { authenticated: false, response: Response.json({ code: auth.denialStatus === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: auth.denialStatus }) },
}));

vi.mock("@/lib/academic/student-statistics", () => ({
  getStudentAcademicSummary: services.summary,
  getStudentClassDetail: services.detail,
}));

import { GET as getClasses } from "@/app/api/student/classes/route";
import { GET as getClassDetail } from "@/app/api/student/classes/[classId]/route";

const context = { params: Promise.resolve({ classId: "class-a" }) };
const safeDetail = {
  id: "class-a",
  name: "Programación I",
  groupName: "Grupo A",
  academicYear: "2026–2027",
  teacherName: "Docente Uno",
  status: "active",
  enrollmentStatus: "active",
  attendance: { present: 1, absent: 0, suspicious: 0, eligibleSessions: 1, percentage: 100 },
  history: [{ sessionId: "session-a", openedAt: "2026-09-23T09:00:00Z", registeredAt: "2026-09-23T09:03:00Z", status: "present", origin: "qr" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.authenticated = false;
  auth.denialStatus = 401;
  services.summary.mockResolvedValue({ classes: [], overall: { present: 0, eligibleSessions: 0, percentage: null, classCount: 0 } });
  services.detail.mockResolvedValue(safeDetail);
});

describe("student academic API authorization", () => {
  it("requires authentication and student role", async () => {
    expect((await getClasses()).status).toBe(401);
    auth.denialStatus = 403;
    expect((await getClassDetail(new Request("https://test.invalid"), context)).status).toBe(403);
    expect(services.summary).not.toHaveBeenCalled();
    expect(services.detail).not.toHaveBeenCalled();
  });

  it("derives student identity from the authenticated account", async () => {
    auth.authenticated = true;
    const response = await getClasses();
    expect(response.status).toBe(200);
    expect(services.summary).toHaveBeenCalledWith(auth.userId, auth.email);
  });

  it("allows enrolled detail and returns no private moderation or device fields", async () => {
    auth.authenticated = true;
    const response = await getClassDetail(new Request("https://test.invalid"), context);
    expect(response.status).toBe(200);
    expect(services.detail).toHaveBeenCalledWith(auth.userId, auth.email, "class-a");
    const serialized = JSON.stringify(await response.json());
    for (const field of ["teacher_note", "manual_reason", "device_hash", "gps_status", "network_city", "audit"]) {
      expect(serialized).not.toContain(field);
    }
  });

  it("conceals a class without enrollment as not found", async () => {
    auth.authenticated = true;
    services.detail.mockResolvedValueOnce(null);
    const response = await getClassDetail(new Request("https://test.invalid"), context);
    expect(response.status).toBe(404);
  });

  it("allows historical detail for an inactive enrollment relationship", async () => {
    auth.authenticated = true;
    services.detail.mockResolvedValueOnce({ ...safeDetail, enrollmentStatus: "inactive" });
    const response = await getClassDetail(new Request("https://test.invalid"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ class: { enrollmentStatus: "inactive" } });
  });
});
