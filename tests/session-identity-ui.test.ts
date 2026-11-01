import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACADEMIC_COLOR_KEYS, academicColor, isAcademicColorKey, sessionDisplayName } from "@/lib/academic/colors";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("v0.6.4 session identity and academic colors", () => {
  it("keeps one controlled color mapping with a blue historical fallback", () => {
    expect(ACADEMIC_COLOR_KEYS).toEqual(["blue", "navy", "cyan", "green", "amber", "red", "purple", "slate"]);
    expect(isAcademicColorKey("purple")).toBe(true);
    expect(isAcademicColorKey("#ff00ff")).toBe(false);
    expect(academicColor("unknown").key).toBe("blue");
    expect(sessionDisplayName(null)).toBe("Sesión");
    expect(source("lib/academic/colors.ts")).not.toContain("`bg-${");
  });

  it("collects and persists class and session identity through validated APIs", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    const classRoute = source("app/api/classes/route.ts");
    const classDetailRoute = source("app/api/classes/[classId]/route.ts");
    const sessionRoute = source("app/api/sessions/route.ts");
    expect(dashboard).toContain("Color de la asignatura");
    expect(dashboard).toContain("Nombre de la sesión");
    expect(dashboard).toContain("Color de la sesión");
    expect(dashboard).toContain("sessionName");
    expect(dashboard).toContain("colorKey: sessionColor");
    expect(classRoute).toContain("color_key: colorKey");
    expect(classDetailRoute).toContain("color_key: colorKey");
    expect(sessionRoute).toContain("session_name: sessionName");
    expect(sessionRoute).toContain("color_key: body.colorKey");
  });

  it("renders names and color markers without changing attendance-state colors", () => {
    const matrix = source("components/teacher-attendance-matrix.tsx");
    const service = source("lib/academic/attendance-matrix.ts");
    const student = source("components/student-class-detail.tsx");
    const projection = source("components/teacher-projection.tsx");
    expect(service).toContain("session_name");
    expect(service).toContain("color_key");
    expect(matrix).toContain("session.name");
    expect(matrix).toContain("session.colorKey");
    expect(matrix).toContain("date.compact} · {date.time");
    expect(matrix).toContain("bg-emerald-50");
    expect(matrix).toContain("bg-rose-50");
    expect(matrix).toContain("bg-amber-50");
    expect(student).toContain("row.name");
    expect(student).toContain("row.colorKey");
    expect(projection).toContain("sessionDisplayName(session.session_name)");
  });
});
