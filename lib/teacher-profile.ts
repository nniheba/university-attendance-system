import type { User } from "@supabase/supabase-js";
import { deriveInstitutionalDisplayName } from "@/lib/security/institutional-email";

export const TEACHER_AVATAR_KEYS = [
  "avatar_01",
  "avatar_02",
  "avatar_03",
  "avatar_04",
  "avatar_05",
  "avatar_06",
] as const;

export type TeacherAvatarKey = (typeof TEACHER_AVATAR_KEYS)[number];

export interface TeacherProfile {
  user_id: string;
  display_name: string;
  avatar_key: TeacherAvatarKey;
  created_at: string;
  updated_at: string;
}

const AVATAR_PATHS: Record<TeacherAvatarKey, string> = {
  avatar_01: "/avatars/teacher-01.svg",
  avatar_02: "/avatars/teacher-02.svg",
  avatar_03: "/avatars/teacher-03.svg",
  avatar_04: "/avatars/teacher-04.svg",
  avatar_05: "/avatars/teacher-05.svg",
  avatar_06: "/avatars/teacher-06.svg",
};

export function normalizeProfileDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= 2 && normalized.length <= 80 ? normalized : null;
}

export function isTeacherAvatarKey(value: unknown): value is TeacherAvatarKey {
  return typeof value === "string" && TEACHER_AVATAR_KEYS.includes(value as TeacherAvatarKey);
}

export function teacherAvatarPath(key: TeacherAvatarKey): string {
  return AVATAR_PATHS[key];
}

export function defaultTeacherDisplayName(user: Pick<User, "email" | "user_metadata">): string {
  return deriveInstitutionalDisplayName(user.email) || "Docente";
}
