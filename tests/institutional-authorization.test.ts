import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  account: null as null | { user_id: string; email: string; role: "student" | "teacher"; created_at: string; updated_at: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerAuthClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.user ? null : new Error("missing") }) },
  }),
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: state.account, error: null })),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/security/teacher-profile", () => ({ getOrCreateTeacherProfile: vi.fn() }));

import { requireInstitutionalUser, requireStudent, requireTeacher } from "@/lib/security/institutional-auth";

beforeEach(() => {
  state.user = { id: "user-a", email: "person@students.example.edu" };
  state.account = {
    user_id: "user-a",
    email: "person@students.example.edu",
    role: "student",
    created_at: "now",
    updated_at: "now",
  };
});

describe("server-side institutional role authorization", () => {
  it("denies anonymous and external authenticated users", async () => {
    state.user = null;
    const anonymous = await requireInstitutionalUser();
    expect(anonymous.authenticated).toBe(false);
    if (!anonymous.authenticated) expect(anonymous.response.status).toBe(401);

    state.user = { id: "external", email: "person@gmail.com" };
    const external = await requireInstitutionalUser();
    expect(external.authenticated).toBe(false);
    if (!external.authenticated) expect((await external.response.json()).code).toBe("INSTITUTIONAL_ACCESS_REQUIRED");
  });

  it("allows a student only through the student guard", async () => {
    expect((await requireStudent()).authenticated).toBe(true);
    const teacher = await requireTeacher();
    expect(teacher.authenticated).toBe(false);
    if (!teacher.authenticated) expect(teacher.response.status).toBe(403);
  });

  it("keeps an allowlisted teacher authorized and rejects student registration", async () => {
    state.user = { id: "user-a", email: "teacher.one@faculty.example.edu" };
    state.account = {
      ...state.account!,
      email: "teacher.one@faculty.example.edu",
      role: "teacher",
    };
    expect((await requireTeacher()).authenticated).toBe(true);
    const student = await requireStudent();
    expect(student.authenticated).toBe(false);
    if (!student.authenticated) expect(student.response.status).toBe(403);
  });
});
