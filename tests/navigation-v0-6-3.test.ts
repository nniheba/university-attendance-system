import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("v0.6.3 role-aware navigation", () => {
  it("defines the complete student and teacher menus with role-aware homes", () => {
    const shell = source("components/institutional-shell.tsx");
    for (const label of ["Inicio", "Escanear", "Mis asignaturas", "Asignaturas", "Perfil"]) {
      expect(shell).toContain(`label: "${label}"`);
    }
    expect(shell).toContain('role === "teacher" ? "/teacher" : role === "student" ? "/student" : "/"');
    expect(shell).toContain('aria-label="Navegación principal"');
    expect(shell).toContain('aria-current={current ? "page" : undefined}');
  });

  it("provides an accessible mobile menu that closes by Escape, outside click and navigation", () => {
    const shell = source("components/institutional-shell.tsx");
    expect(shell).toContain("aria-expanded={menuOpen}");
    expect(shell).toContain("aria-controls={menuId}");
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('document.addEventListener("pointerdown", closeOutside)');
    expect(shell).toContain("onNavigate={() => setMenuOpen(false)}");
    expect(shell).toContain("min-h-11");
  });

  it("renders linked typed breadcrumbs and a non-link current page", () => {
    const shell = source("components/institutional-shell.tsx");
    expect(shell).toContain("export interface BreadcrumbItem");
    expect(shell).toContain("href?: string");
    expect(shell).toContain('aria-current={current ? "page" : undefined}');
    expect(source("components/teacher-attendance-matrix.tsx")).toContain("href: `/teacher/classes/${matrix.class.id}`");
    expect(source("components/student-class-detail.tsx")).toContain('href: "/student#asignaturas"');
  });

  it("uses deterministic back links and keeps projection navigation minimal", () => {
    expect(source("components/student-class-detail.tsx")).toContain("← Volver a mis asignaturas");
    expect(source("components/teacher-class-detail.tsx")).toContain("← Volver a mis asignaturas");
    expect(source("components/teacher-attendance-matrix.tsx")).toContain("← Volver a {matrix.class.name}");
    expect(source("components/student-scanner.tsx")).toContain("← Volver al inicio");
    expect(source("components/student-profile-form.tsx")).toContain("← Volver al inicio");
    expect(source("components/teacher-profile-form.tsx")).toContain("← Volver al inicio");
    const projection = source("components/teacher-projection.tsx");
    expect(projection).toContain("homeLink={false}");
    expect(projection).not.toContain('role="teacher"');
  });
});
