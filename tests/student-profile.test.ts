import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authorized: true }));
const getStudentProfile = vi.hoisted(() => vi.fn());

vi.mock("@/lib/security/institutional-auth", () => ({
  requireStudent: async () => state.authorized
    ? { authenticated: true, user: { id: "student-a" }, account: { role: "student" } }
    : { authenticated: false, response: Response.json({ code: "FORBIDDEN" }, { status: 403 }) },
}));
vi.mock("@/lib/security/student-profile", () => ({ getStudentProfile }));

import { GET, PATCH } from "@/app/api/student/profile/route";

beforeEach(() => {
  vi.clearAllMocks();
  state.authorized = true;
  getStudentProfile.mockResolvedValue({ user_id: "student-a", display_name: "Student A" });
});

describe("student profile", () => {
  it("protects profile reads and reads only the authenticated profile", async () => {
    state.authorized = false;
    expect((await GET()).status).toBe(403);
    expect(getStudentProfile).not.toHaveBeenCalled();

    state.authorized = true;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(getStudentProfile).toHaveBeenCalledWith("student-a");
  });

  it("rejects every browser attempt to patch the institutional name", async () => {
    const response = PATCH();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(await response.json()).toMatchObject({
      code: "IMMUTABLE_PROFILE",
      message: expect.stringContaining("no puede modificarse"),
    });
  });

  it("renders the student name and email as read-only institutional fields", () => {
    const source = readFileSync(new URL("../components/student-profile-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("readOnly value={initialProfile.display_name}");
    expect(source).toContain("readOnly value={email}");
    expect(source).not.toContain('method: "PATCH"');
    expect(source).not.toContain("setDisplayName");
  });
});
