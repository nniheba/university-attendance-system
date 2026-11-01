import { describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => ({ authenticated: true, user: { id: "teacher-a" } }),
  teacherOwnsSession: async () => true,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { GET } from "@/app/api/sessions/[id]/export/route";

describe("removed session export", () => {
  it("returns SESSION_REMOVED before reading attendance evidence", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: vi.fn(async () => ({
        data: {
          id: "session-a",
          session_name: "Sesión retirada",
          opened_at: "2026-09-29T09:00:00Z",
          deleted_at: "2026-09-29T10:00:00Z",
          class: { name: "Programación", group_name: "A", academic_year: "2026" },
        },
        error: null,
      })),
    };
    admin.from.mockReturnValue(query);
    const response = await GET(new Request("https://test.invalid/export"), { params: Promise.resolve({ id: "session-a" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "SESSION_REMOVED" });
    expect(admin.from).toHaveBeenCalledTimes(1);
  });
});

