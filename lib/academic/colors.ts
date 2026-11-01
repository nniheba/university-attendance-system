export const ACADEMIC_COLOR_KEYS = [
  "blue",
  "navy",
  "cyan",
  "green",
  "amber",
  "red",
  "purple",
  "slate",
] as const;

export type AcademicColorKey = typeof ACADEMIC_COLOR_KEYS[number];

interface AcademicColorPresentation {
  key: AcademicColorKey;
  label: string;
  markerClass: string;
  borderClass: string;
  selectedClass: string;
}

export const ACADEMIC_COLORS: readonly AcademicColorPresentation[] = [
  { key: "blue", label: "Azul", markerClass: "bg-blue-600", borderClass: "border-t-blue-600", selectedClass: "border-blue-600 ring-blue-600" },
  { key: "navy", label: "Azul marino", markerClass: "bg-slate-800", borderClass: "border-t-slate-800", selectedClass: "border-slate-800 ring-slate-800" },
  { key: "cyan", label: "Cian", markerClass: "bg-cyan-500", borderClass: "border-t-cyan-500", selectedClass: "border-cyan-500 ring-cyan-500" },
  { key: "green", label: "Verde", markerClass: "bg-emerald-600", borderClass: "border-t-emerald-600", selectedClass: "border-emerald-600 ring-emerald-600" },
  { key: "amber", label: "Ámbar", markerClass: "bg-amber-500", borderClass: "border-t-amber-500", selectedClass: "border-amber-500 ring-amber-500" },
  { key: "red", label: "Rojo", markerClass: "bg-rose-600", borderClass: "border-t-rose-600", selectedClass: "border-rose-600 ring-rose-600" },
  { key: "purple", label: "Morado", markerClass: "bg-violet-600", borderClass: "border-t-violet-600", selectedClass: "border-violet-600 ring-violet-600" },
  { key: "slate", label: "Gris", markerClass: "bg-slate-500", borderClass: "border-t-slate-500", selectedClass: "border-slate-500 ring-slate-500" },
] as const;

const COLOR_KEYS = new Set<string>(ACADEMIC_COLOR_KEYS);
const COLOR_PRESENTATIONS = new Map(ACADEMIC_COLORS.map((color) => [color.key, color]));

export function isAcademicColorKey(value: unknown): value is AcademicColorKey {
  return typeof value === "string" && COLOR_KEYS.has(value);
}

export function academicColor(value: unknown): AcademicColorPresentation {
  const key = isAcademicColorKey(value) ? value : "blue";
  return COLOR_PRESENTATIONS.get(key) ?? ACADEMIC_COLORS[0];
}

export function sessionDisplayName(value: string | null | undefined): string {
  return value?.trim() || "Sesión";
}
