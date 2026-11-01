import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("student academic dashboard UI", () => {
  it("keeps scanning primary while presenting weighted academic cards", () => {
    const dashboard = source("components/student-dashboard.tsx");
    expect(dashboard).toContain("Escanear asistencia");
    expect(dashboard).toContain("Asistencia global");
    expect(dashboard).toContain("Sesiones computables");
    expect(dashboard).toContain("Mis asignaturas");
    expect(dashboard).toContain("No tienes asignaturas activas todavía.");
    expect(dashboard).toContain("sm:grid-cols-3");
  });

  it("renders restrained class history states without private evidence", () => {
    const detail = source("components/student-class-detail.tsx");
    expect(detail).toContain("Historial de sesiones");
    expect(detail).toContain("Presente");
    expect(detail).toContain("Ausente");
    expect(detail).toContain("En revisión");
    expect(detail).toContain("Manual");
    expect(detail).toContain("Aún no hay sesiones computables.");
    expect(detail).not.toContain("teacher_note");
    expect(detail).not.toContain("manual_reason");
    expect(detail).not.toContain("device_hash");
    expect(detail).not.toContain("gps_status");
  });
});
