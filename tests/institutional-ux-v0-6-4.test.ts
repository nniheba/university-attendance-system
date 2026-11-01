import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("v0.6.4 institutional UX", () => {
  it("uses Inter and the independent Campus Attendance color system", () => {
    const layout = source("app/layout.tsx");
    const styles = source("app/globals.css");
    expect(layout).toContain('import { Inter } from "next/font/google"');
    expect(layout).toContain('display: "swap"');
    expect(styles).toContain("--campus-blue: #2563eb");
    expect(styles).toContain("--campus-blue-dark: #1d4ed8");
    expect(styles).toContain("--campus-border: #dbe3ed");
    expect(styles).toContain("prefers-reduced-motion: reduce");
  });

  it("uses sentence case and a neutral project footer", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    const classDetail = source("components/teacher-class-detail.tsx");
    const shell = source("components/institutional-shell.tsx");
    expect(dashboard).toContain("Nueva asignatura");
    expect(dashboard).not.toContain("+ NUEVA ASIGNATURA");
    expect(classDetail).toContain("Agregar estudiante");
    expect(classDetail).toContain("Guardar cambios");
    expect(shell).not.toContain("Prototipo académico");
    expect(shell).toContain("Proyecto universitario de código abierto");
    expect(shell).not.toContain('target="_blank"');
  });

  it("provides accessible route and mutation loading feedback", () => {
    const loading = source("components/institutional-loading.tsx");
    for (const copy of ["Cargando…", "Guardando cambios…", "Agregando estudiante…", "Anulando asistencia…"]) {
      const combined = [
        loading,
        source("components/teacher-dashboard.tsx"),
        source("components/teacher-class-detail.tsx"),
      ].join("\n");
      expect(combined).toContain(copy);
    }
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(loading).toContain('aria-busy="true"');
    expect(source("app/teacher/loading.tsx")).toContain("InstitutionalRouteSkeleton");
    expect(source("app/student/profile/loading.tsx")).toContain("InstitutionalRouteSkeleton");
    const classDetail = source("components/teacher-class-detail.tsx");
    for (const copy of ["Agregando estudiante…", "Desactivando matrícula…", "Reactivando matrícula…", "Archivando asignatura…"]) {
      expect(classDetail).toContain(copy);
    }
    expect(classDetail).toContain(".finally(() => setLoading(false))");
    expect(source("components/teacher-attendance-matrix.tsx")).toContain("Guardando corrección…");
    expect(source("components/teacher-profile-form.tsx")).toContain("Actualizando perfil…");
  });

  it("keeps identity as one link with text before the avatar", () => {
    const shell = source("components/institutional-shell.tsx");
    const textPosition = shell.indexOf('<span className="min-w-0 flex-1 text-right">');
    const avatarPosition = shell.indexOf("identity.avatarSrc &&");
    expect(textPosition).toBeGreaterThan(-1);
    expect(avatarPosition).toBeGreaterThan(textPosition);
    expect(shell).toContain("block truncate text-sm");
    expect(shell).toContain("block truncate text-xs");
    expect(shell.match(/aria-label=\{`Abrir perfil de \$\{identity\.name\}`\}/g)).toHaveLength(2);
    expect(shell.match(/href=\{identity\.href\}/g)).toHaveLength(2);
    expect(shell).toContain('className="flex min-h-11 min-w-0 flex-1 items-center gap-2');
    expect(shell).toContain("{actions}");
  });

  it("defers QR generation code until a teacher opens attendance", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    expect(dashboard).not.toContain('import QRCode from "qrcode"');
    expect(dashboard).toContain('await import("qrcode")');
  });

  it("updates the profile locally without an unnecessary full route refresh", () => {
    const profile = source("components/teacher-profile-form.tsx");
    const saveBlock = profile.slice(profile.indexOf("async function saveProfile"), profile.indexOf("async function signOut"));
    expect(saveBlock).toContain("setProfile(body.profile)");
    expect(saveBlock).not.toContain("router.refresh()");
  });
});
