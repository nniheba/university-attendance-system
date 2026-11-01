export function cleanAcademicLabel(value: unknown, maximumLength = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/gu, " ");
  return cleaned.length >= 1 && cleaned.length <= maximumLength ? cleaned : null;
}

export function cleanOptionalAcademicLabel(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return cleanAcademicLabel(value, maximumLength) ?? undefined;
}
