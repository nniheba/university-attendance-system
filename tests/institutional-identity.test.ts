import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveInstitutionalDisplayName,
  institutionalEmailAudience,
  maskInstitutionalEmail,
  normalizeInstitutionalEmail,
} from "@/lib/security/institutional-email";
import { normalizeStudentDisplayName } from "@/lib/student-profile";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  accounts: new Map<string, Record<string, unknown>>(),
  studentProfiles: new Map<string, Record<string, unknown>>(),
  teacherProfiles: new Set<string>(),
}));

const admin = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    const filters = new Map<string, unknown>();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      maybeSingle: vi.fn(async () => {
        if (table === "teacher_allowlist") {
          const email = String(filters.get("email"));
          return { data: state.allowed.has(email) ? { email } : null, error: null };
        }
        const userId = String(filters.get("user_id"));
        return { data: state.accounts.get(userId) ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const userId = String(filters.get("user_id"));
        return { data: state.accounts.get(userId) ?? null, error: null };
      }),
      upsert: vi.fn(async (value: Record<string, unknown>) => {
        const userId = String(value.user_id);
        if (table === "institutional_accounts") {
          const previous = state.accounts.get(userId);
          state.accounts.set(userId, {
            created_at: previous?.created_at ?? "created",
            updated_at: "updated",
            ...value,
          });
        }
        if (table === "student_profiles" && !state.studentProfiles.has(userId)) {
          state.studentProfiles.set(userId, value);
        }
        return { error: null };
      }),
    };
    return query;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => admin,
  createServerAuthClient: vi.fn(),
}));
vi.mock("@/lib/security/teacher-profile", () => ({
  getOrCreateTeacherProfile: async (user: { id: string }) => {
    state.teacherProfiles.add(user.id);
    return { user_id: user.id };
  },
}));
const linkStudentEnrollments = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("@/lib/academic/enrollments", () => ({ linkStudentEnrollments }));

import {
  bootstrapInstitutionalAccount,
  isTeacherAccessNotAuthorized,
  roleForInstitutionalEmail,
} from "@/lib/security/institutional-auth";

function user(id: string, email: string) {
  return { id, email, user_metadata: {}, app_metadata: {}, aud: "authenticated", created_at: "now" };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.allowed.clear();
  state.accounts.clear();
  state.studentProfiles.clear();
  state.teacherProfiles.clear();
  linkStudentEnrollments.mockClear();
});

describe("institutional email and initial display name", () => {
  it.each([
    [" STUDENT.ONE@STUDENTS.EXAMPLE.EDU ", "student.one@students.example.edu"],
    ["teacher.one@faculty.example.edu", "teacher.one@faculty.example.edu"],
  ])("accepts and normalizes %s", (input, expected) => {
    expect(normalizeInstitutionalEmail(input)).toBe(expected);
  });

  it.each([
    "student@gmail.com",
    "student@subdomain.faculty.example.edu",
    "student@faculty.example.edu.evil.com",
    "person@fake.students.example.edu",
    "person@students.example.edu.evil.com",
    "@faculty.example.edu",
    "bad..local@faculty.example.edu",
    "",
  ])("rejects non-institutional or malformed email %s", (email) => {
    expect(normalizeInstitutionalEmail(email)).toBeNull();
  });

  it.each([
    ["student.one@students.example.edu", "Student One"],
    ["teacher.one@faculty.example.edu", "Teacher One"],
    ["ana_maria.lopez@students.example.edu", "Ana Maria Lopez"],
  ])("derives %s safely", (email, expected) => {
    expect(deriveInstitutionalDisplayName(email)).toBe(expected);
  });

  it("uses safe fallbacks for malformed inputs and normalizes edited names", () => {
    expect(deriveInstitutionalDisplayName("malformed")).toBeNull();
    expect(maskInstitutionalEmail("malformed")).toBe("correo institucional");
    expect(normalizeStudentDisplayName("  Nicolás   Herrera ")).toBe("Nicolás Herrera");
  });

  it("classifies only the exact student and teacher domains", () => {
    expect(institutionalEmailAudience("student@students.example.edu")).toBe("student");
    expect(institutionalEmailAudience("teacher@faculty.example.edu")).toBe("teacher");
    expect(institutionalEmailAudience("person@fake.students.example.edu")).toBeNull();
  });
});

describe("institutional account bootstrap", () => {
  it("assigns the student domain automatically and is idempotent", async () => {
    const accountUser = user("student-a", "student.one@students.example.edu");
    const first = await bootstrapInstitutionalAccount(accountUser);
    const second = await bootstrapInstitutionalAccount(accountUser);
    expect(first.account.role).toBe("student");
    expect(second.account.role).toBe("student");
    expect(state.accounts.size).toBe(1);
    expect(state.studentProfiles.size).toBe(1);
    expect(state.studentProfiles.get("student-a")?.display_name).toBe("Student One");
    expect(linkStudentEnrollments).toHaveBeenCalledWith("student-a", "student.one@students.example.edu");
  });

  it("assigns teacher only when the normalized email is active in the server allowlist", async () => {
    state.allowed.add("teacher.one@faculty.example.edu");
    const identity = await bootstrapInstitutionalAccount(user("teacher-a", "TEACHER.ONE@faculty.example.edu"));
    expect(identity.account.role).toBe("teacher");
    expect(state.teacherProfiles.has("teacher-a")).toBe(true);
    expect(state.studentProfiles.has("teacher-a")).toBe(false);
    expect(roleForInstitutionalEmail("teacher.one@faculty.example.edu", true)).toBe("teacher");
  });

  it("denies a non-allowlisted teacher-domain account instead of making it a student", async () => {
    const attempt = bootstrapInstitutionalAccount(user("staff-a", "person@faculty.example.edu"));
    await expect(attempt).rejects.toSatisfy(isTeacherAccessNotAuthorized);
    expect(roleForInstitutionalEmail("person@faculty.example.edu", false)).toBeNull();
    expect(state.accounts.size).toBe(0);
    expect(state.studentProfiles.size).toBe(0);
  });

  it("denies bootstrap for a non-institutional authenticated user", async () => {
    await expect(bootstrapInstitutionalAccount(user("external", "person@gmail.com"))).rejects.toThrow("INSTITUTIONAL_EMAIL_REQUIRED");
    expect(state.accounts.size).toBe(0);
  });
});
