import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("teacher attendance matrix UI", () => {
  it("protects the dedicated route with teacher role and class ownership", () => {
    const page = source("app/teacher/classes/[classId]/attendance/page.tsx");
    expect(page).toContain("requireTeacher()");
    expect(page).toContain("teacherOwnsClass(classId, auth.user.id)");
  });

  it("provides accessible effective states, filters, sticky columns and horizontal scrolling", () => {
    const component = source("components/teacher-attendance-matrix.tsx");
    for (const text of ["Presente", "Ausente", "No registró", "En revisión", "No aplica", "Mostrar inactivos", "Por debajo de 80%", "Menor asistencia", "Exportar CSV"]) {
      expect(component).toContain(text);
    }
    expect(component).toContain("overflow-auto");
    expect(component).toContain("sticky left-0");
    expect(component).toContain("sticky right-0");
    expect(component).toContain("aria-label");
    expect(component).toContain('selected.cell.effectiveStatus === "not_applicable"');
    expect(component).not.toContain('selected.cell.effectiveStatus === "not_registered" ?');
  });

  it("keeps raw detail restrained and requires a correction reason", () => {
    const component = source("components/teacher-attendance-matrix.tsx");
    expect(component).toContain("Motivo de la corrección");
    expect(component).toContain("Restablecer original");
    expect(component).toContain("Historial de cambios");
    expect(component).not.toContain("device_hash");
    expect(component).not.toContain("latitude");
    expect(component).not.toContain("longitude");
  });

  it("uses canonical activate/deactivate controls and keeps session removal auditable", () => {
    const component = source("components/teacher-attendance-matrix.tsx");
    for (const text of [
      "Desactivar",
      "Activar",
      "Desactivar matrícula",
      "Inactivo",
      "Eliminar sesión de la matriz",
      "Motivo de eliminación",
      "ELIMINAR SESIÓN",
      "Los registros de asistencia existentes se conservarán internamente para auditoría.",
    ]) expect(component).toContain(text);
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain('body: JSON.stringify({ action })');
    expect(component).toContain('showInactive || row.enrollmentStatus === "active"');
    expect(component).toContain('method: "DELETE"');
    expect(component).toContain('tone="danger"');
    expect(component).not.toContain("Eliminar estudiante de la asignatura");
    expect(component).not.toContain("ELIMINAR ESTUDIANTE");
    expect(component).not.toContain("window.confirm");
    expect(component).not.toContain("window.prompt");
    expect(component).not.toContain("window.alert");
  });
});
