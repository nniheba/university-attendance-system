import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassRecord } from "@/lib/types";

const rows = vi.hoisted(() => ({
  enrollments: [] as unknown[],
  sessions: [] as unknown[],
  overrides: [] as unknown[],
}));

const admin = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(() => query),
      is: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
        data: table === "class_enrollments" ? rows.enrollments : table === "sessions" ? rows.sessions : rows.overrides,
        error: null,
      })),
    };
    return query;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { getTeacherClassSummaries } from "@/lib/academic/teacher-statistics";

const course: ClassRecord = {
  id: "class-a",
  name: "Programación I",
  teacher_name: "Docente Uno",
  teacher_id: "teacher-a",
  group_name: "Grupo A",
  academic_year: "2026–2027",
  status: "active",
  enrollment_mode: "closed",
  color_key: "blue",
  updated_at: "2026-09-23T00:00:00Z",
  archived_at: null,
  created_at: "2026-09-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  rows.enrollments = [
    {
      id: "enrollment-a",
      class_id: "class-a",
      student_email: "a@students.example.edu",
      student_user_id: "student-a",
      status: "active",
    },
    {
      id: "enrollment-b",
      class_id: "class-a",
      student_email: "b@students.example.edu",
      student_user_id: "student-b",
      status: "active",
    },
  ];
  rows.sessions = Array.from({ length: 8 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const sessionId = `session-${index + 1}`;
    const attendance = [] as Array<Record<string, unknown>>;
    if (index < 2) attendance.push({ id: `a-${index}`, session_id: sessionId, student_user_id: "student-a", student_email_snapshot: "a@students.example.edu", registered_at: `2026-09-${day}T09:01:00Z`, source: "qr", review_status: "normal", voided_at: null });
    if (index === 0) attendance.push({ id: "b-0", session_id: sessionId, student_user_id: "student-b", student_email_snapshot: "b@students.example.edu", registered_at: "2026-09-01T09:02:00Z", source: "manual", review_status: "normal", voided_at: null });
    return {
      id: sessionId,
      class_id: "class-a",
      opened_at: `2026-09-${day}T09:00:00Z`,
      closed_at: `2026-09-${day}T10:00:00Z`,
      status: "closed",
      counts_toward_attendance: true,
      attendance,
    };
  });
  rows.overrides = [{ class_id: "class-a", session_id: "session-1", enrollment_id: "enrollment-b", status: "absent" }];
});

describe("teacher class academic summaries", () => {
  it("weights present opportunities instead of averaging student percentages", async () => {
    const [summary] = await getTeacherClassSummaries([course]);
    expect(summary).toMatchObject({
      student_count: 2,
      session_count: 8,
      closed_session_count: 8,
      average_attendance_percentage: 12.5,
    });
    expect(admin.from).toHaveBeenCalledTimes(3);
  });
});
