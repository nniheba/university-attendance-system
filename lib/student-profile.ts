export interface StudentProfile {
  user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export function normalizeStudentDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= 2 && normalized.length <= 80 ? normalized : null;
}
