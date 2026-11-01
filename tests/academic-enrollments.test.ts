import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  accounts: new Map<string, { user_id: string; email: string; role: string }>(),
  enrollments: [] as Array<{ id: string; student_email: string; student_user_id: string | null }>,
}));

const admin = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    const filters = new Map<string, unknown>();
    let updateValue: Record<string, unknown> | null = null;
    const query = {
      select: vi.fn(() => query),
      update: vi.fn((value: Record<string, unknown>) => { updateValue = value; return query; }),
      eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      is: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      maybeSingle: vi.fn(async () => {
        if (table !== "institutional_accounts") return { data: null, error: null };
        const account = state.accounts.get(String(filters.get("user_id")));
        const matches = account
          && account.email === filters.get("email")
          && account.role === filters.get("role");
        return { data: matches ? account : null, error: null };
      }),
      then: (resolve: (value: unknown) => unknown) => {
        const updated = table === "class_enrollments" && updateValue
          ? state.enrollments.filter((row) => {
            const matches = row.student_email === filters.get("student_email")
              && row.student_user_id === filters.get("student_user_id");
            if (matches) Object.assign(row, updateValue);
            return matches;
          })
          : [];
        return Promise.resolve(resolve({ data: updated.map((row) => ({ id: row.id })), error: null }));
      },
    };
    return query;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { linkStudentEnrollments, normalizeStudentEnrollmentEmail } from "@/lib/academic/enrollments";

beforeEach(() => {
  vi.clearAllMocks();
  state.accounts.clear();
  state.enrollments = [];
});

describe("late institutional enrollment linking", () => {
  it("links every matching enrollment once and remains idempotent", async () => {
    state.accounts.set("student-a", { user_id: "student-a", email: "student.a@students.example.edu", role: "student" });
    state.enrollments = [
      { id: "one", student_email: "student.a@students.example.edu", student_user_id: null },
      { id: "two", student_email: "student.a@students.example.edu", student_user_id: null },
    ];
    await expect(linkStudentEnrollments("student-a", " STUDENT.A@STUDENTS.EXAMPLE.EDU ")).resolves.toBe(2);
    await expect(linkStudentEnrollments("student-a", "student.a@students.example.edu")).resolves.toBe(0);
    expect(state.enrollments.every((row) => row.student_user_id === "student-a")).toBe(true);
  });

  it("never claims another institutional email and rejects teacher domains", async () => {
    state.accounts.set("student-a", { user_id: "student-a", email: "student.a@students.example.edu", role: "student" });
    await expect(linkStudentEnrollments("student-a", "student.b@students.example.edu")).rejects.toThrow("STUDENT_IDENTITY_REQUIRED");
    expect(normalizeStudentEnrollmentEmail("teacher@faculty.example.edu")).toBeNull();
  });
});
