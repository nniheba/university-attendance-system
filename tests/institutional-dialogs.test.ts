import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const root = fileURLToPath(new URL("..", import.meta.url));

function sourceTree(path: string): string {
  const absolute = resolve(root, path);
  return readdirSync(absolute).flatMap((entry) => {
    const child = resolve(absolute, entry);
    return statSync(child).isDirectory() ? sourceTree(resolve(path, entry)) : /\.(?:ts|tsx)$/u.test(entry) ? [readFileSync(child, "utf8")] : [];
  }).join("\n");
}

describe("institutional dialog system", () => {
  it("has one accessible reusable modal with focus entry, trapping, Escape and restoration", () => {
    const dialog = source("components/institutional-dialog.tsx");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("returnFocusRef.current?.focus()");
    expect(dialog).toContain("data-dialog-autofocus");
    expect(dialog).toContain("if (event.currentTarget === event.target && !busy) onCancel()");
  });

  it("covers all teacher confirmation and moderation workflows with typed modal state", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    const classDetail = source("components/teacher-class-detail.tsx");
    const matrix = source("components/teacher-attendance-matrix.tsx");
    for (const expected of [
      "Cerrar sesión de asistencia",
      "Nota docente",
      "Marcar asistencia como sospechosa",
      "Quitar marca de revisión",
      "Anular asistencia",
      "Restablecer dispositivo",
    ]) expect(dashboard).toContain(expected);
    expect(classDetail).toContain("Archivar asignatura");
    expect(classDetail).toContain("Desactivar matrícula");
    expect(classDetail).toContain("Restablecer cuenta del estudiante");
    expect(matrix).toContain("<InstitutionalDialog");
    expect(matrix).toContain("Editar sesión");
    expect(`${dashboard}${classDetail}${matrix}`).toContain("pendingLabel=");
    expect(`${dashboard}${classDetail}${matrix}`).toContain("error={dialogError}");
  });

  it("removes browser-native application dialogs from source", () => {
    const application = ["app", "components", "lib"].map(sourceTree).join("\n");
    expect(application).not.toMatch(/window\.(?:prompt|confirm|alert)\s*\(/u);
  });
});
