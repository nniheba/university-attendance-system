import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrollmentRecord } from "@/lib/types";

const profiles = vi.hoisted(() => [
  { user_id: "student-a", display_name: "Ana García" },
  { user_id: "student-b", display_name: "Bruno López" },
]);

const inFilter = vi.hoisted(() => vi.fn(async () => ({ data: profiles, error: null })));
const select = vi.hoisted(() => vi.fn(() => ({ in: inFilter })));
const from = vi.hoisted(() => vi.fn(() => ({ select })));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ from }) }));

import { enrollmentViews } from "@/lib/academic/enrollments";

const enrollment = (id: string, email: string, userId: string | null): EnrollmentRecord => ({
  id,
  class_id: "class-a",
  student_email: email,
  student_user_id: userId,
  status: "active",
  enrolled_at: "2026-09-24T08:00:00Z",
  unenrolled_at: null,
  created_by: "teacher-a",
  created_at: "2026-09-24T08:00:00Z",
  updated_at: "2026-09-24T08:00:00Z",
});

describe("batched enrollment profile resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads all linked student profiles in one query", async () => {
    const views = await enrollmentViews([
      enrollment("one", "ana.garcia@students.example.edu", "student-a"),
      enrollment("two", "bruno.lopez@students.example.edu", "student-b"),
      enrollment("three", "carla.sanz@students.example.edu", null),
    ]);

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("student_profiles");
    expect(inFilter).toHaveBeenCalledWith("user_id", ["student-a", "student-b"]);
    expect(views.map((view) => view.displayName)).toEqual(["Ana García", "Bruno López", "Carla Sanz"]);
  });
});
