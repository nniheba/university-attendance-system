export interface CoarseLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
}

export function unknownLocation(): CoarseLocation {
  return { city: null, region: null, country: null, countryCode: null };
}

export function coarseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  return text ? text.slice(0, 120) : null;
}

export function countryCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/u.test(code) && code !== "XX" ? code : null;
}
