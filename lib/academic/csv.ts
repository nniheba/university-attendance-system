export const MADRID_TIME_ZONE = "Europe/Madrid";

export function spreadsheetSafeCsvCell(value: string): string {
  const safe = /^[\u0000-\u0020]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function csvDocument(rows: readonly (readonly string[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(spreadsheetSafeCsvCell).join(",")).join("\r\n")}`;
}

export function csvSlug(parts: readonly (string | null | undefined)[], fallback: string): string {
  const value = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  return value || fallback;
}

export function madridDateParts(value: string): { date: string; time: string; isoDate: string } {
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: MADRID_TIME_ZONE,
  }).format(date).replace(".", "");
  const time = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MADRID_TIME_ZONE,
  }).format(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: MADRID_TIME_ZONE,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { date: dateLabel, time, isoDate: `${part("year")}-${part("month")}-${part("day")}` };
}
