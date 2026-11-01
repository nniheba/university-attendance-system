import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionalHeader } from "@/components/institutional-shell";
import {
  defaultTeacherDisplayName,
  isTeacherAvatarKey,
  normalizeProfileDisplayName,
  teacherAvatarPath,
} from "@/lib/teacher-profile";

const state = vi.hoisted(() => ({
  authenticated: false,
  profile: {
    user_id: "123e4567-e89b-42d3-a456-426614174001",
    display_name: "Profesora Inicial",
    avatar_key: "avatar_01" as const,
    created_at: "2026-09-21T10:00:00.000Z",
    updated_at: "2026-09-21T10:00:00.000Z",
  },
}));

const getOrCreateTeacherProfile = vi.hoisted(() => vi.fn(async () => state.profile));
const updateTeacherProfile = vi.hoisted(() => vi.fn(async (_user, avatarKey: string) => ({
  ...state.profile,
  avatar_key: avatarKey,
  updated_at: "2026-09-21T11:00:00.000Z",
})));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => state.authenticated
    ? {
        authenticated: true,
        user: {
          id: state.profile.user_id,
          email: "teacher@example.test",
          user_metadata: {},
        },
      }
    : { authenticated: false, response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) },
}));
vi.mock("@/lib/security/teacher-profile", () => ({
  getOrCreateTeacherProfile,
  updateTeacherProfile,
}));

import { GET, PATCH } from "@/app/api/teacher/profile/route";

function patchProfile(displayName: unknown, avatarKey: unknown) {
  return PATCH(new Request("https://test.invalid/api/teacher/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, avatarKey }),
  }));
}

beforeEach(() => {
  state.authenticated = false;
  vi.clearAllMocks();
});

describe("teacher profile", () => {
  it("normalizes and validates names and local avatar keys", () => {
    expect(normalizeProfileDisplayName("  Ana   García  ")).toBe("Ana García");
    expect(normalizeProfileDisplayName("A")).toBeNull();
    expect(normalizeProfileDisplayName("A".repeat(81))).toBeNull();
    expect(isTeacherAvatarKey("avatar_06")).toBe(true);
    expect(isTeacherAvatarKey("https://example.test/avatar.png")).toBe(false);
    expect(teacherAvatarPath("avatar_02")).toBe("/avatars/teacher-02.svg");
  });

  it("derives a new teacher name from verified institutional email, not editable metadata", () => {
    expect(defaultTeacherDisplayName({ email: "ana.garcia@faculty.example.edu", user_metadata: { display_name: "Forged" } })).toBe("Ana Garcia");
    expect(defaultTeacherDisplayName({ email: "mail@example.test", user_metadata: { name: "Forged" } })).toBe("Docente");
  });

  it("shows the saved profile identity and local avatar in the teacher header", () => {
    const html = renderToStaticMarkup(createElement(InstitutionalHeader, {
      identity: {
        name: "Profesora Actualizada",
        email: "teacher@example.test",
        avatarSrc: teacherAvatarPath("avatar_04"),
        href: "/teacher/profile",
      },
    }));
    expect(html).toContain("Profesora Actualizada");
    expect(html).toContain("teacher@example.test");
    expect(html).toContain("teacher-04.svg");
    expect(html).toContain("/teacher/profile");
  });

  it("protects profile reads from anonymous requests", async () => {
    expect((await GET()).status).toBe(401);
    expect(getOrCreateTeacherProfile).not.toHaveBeenCalled();
  });

  it("reads a profile and updates only its validated avatar", async () => {
    state.authenticated = true;
    const read = await GET();
    expect(read.status).toBe(200);
    expect((await read.json()).profile.display_name).toBe("Profesora Inicial");

    const update = await patchProfile("Nombre manipulado", "avatar_04");
    expect(update.status).toBe(200);
    expect(updateTeacherProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: state.profile.user_id }),
      "avatar_04",
    );
    expect((await update.json()).profile).toMatchObject({
      display_name: "Profesora Inicial",
      avatar_key: "avatar_04",
    });
  });

  it.each(["avatar_99", "https://example.test/avatar.png", null])("rejects an invalid avatar", async (avatarKey) => {
    state.authenticated = true;
    expect((await patchProfile("Nombre manipulado", avatarKey)).status).toBe(400);
    expect(updateTeacherProfile).not.toHaveBeenCalled();
  });

  it("renders teacher name and email read-only while keeping the avatar editable", () => {
    const source = readFileSync(new URL("../components/teacher-profile-form.tsx", import.meta.url), "utf8");
    expect(source).toContain("readOnly value={profile.display_name}");
    expect(source).toContain("readOnly value={email}");
    expect(source).toContain("setAvatarKey");
    expect(source).not.toContain("setDisplayName");
    expect(source).toContain("JSON.stringify({ avatarKey })");
  });
});
