export const TEACHER_INSTITUTIONAL_DOMAIN = "faculty.example.edu";
export const STUDENT_INSTITUTIONAL_DOMAIN = "students.example.edu";

export type InstitutionalEmailAudience = "student" | "teacher";

const INSTITUTIONAL_DOMAINS = new Set([
  TEACHER_INSTITUTIONAL_DOMAIN,
  STUDENT_INSTITUTIONAL_DOMAIN,
]);

const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/u;

export function normalizeInstitutionalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  const parts = email.split("@");
  if (parts.length !== 2 || !INSTITUTIONAL_DOMAINS.has(parts[1])) return null;
  const localPart = parts[0];
  if (
    !localPart ||
    localPart.length > 64 ||
    email.length > 254 ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    localPart.includes("..")
  ) {
    return null;
  }
  return email;
}

export function institutionalEmailAudience(value: unknown): InstitutionalEmailAudience | null {
  const email = normalizeInstitutionalEmail(value);
  if (!email) return null;
  const domain = email.slice(email.indexOf("@") + 1);
  return domain === STUDENT_INSTITUTIONAL_DOMAIN ? "student" : "teacher";
}

export function deriveInstitutionalDisplayName(value: unknown): string | null {
  const email = normalizeInstitutionalEmail(value);
  if (!email) return null;
  const localPart = email.slice(0, email.indexOf("@"));
  const words = localPart.split(/[._-]+/u).filter(Boolean);
  if (words.length === 0) return null;
  const displayName = words
    .map((word) => `${word.charAt(0).toLocaleUpperCase("es-ES")}${word.slice(1)}`)
    .join(" ");
  return displayName.length >= 2 && displayName.length <= 80 ? displayName : null;
}

export function maskInstitutionalEmail(email: string): string {
  const normalized = normalizeInstitutionalEmail(email);
  if (!normalized) return "correo institucional";
  const [localPart, domain] = normalized.split("@");
  return `${localPart.charAt(0)}${"*".repeat(Math.min(3, Math.max(1, localPart.length - 1)))}@${domain}`;
}
