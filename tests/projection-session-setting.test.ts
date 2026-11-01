import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("per-session projection animation setting", () => {
  it("is enabled by default and is submitted during session creation", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    expect(dashboard).toContain("useState(true)");
    expect(dashboard).toContain("enableProjectionBubbles,");
    expect(dashboard).toContain("Animación de registros en proyección");
  });

  it("is editable for active and historical sessions", () => {
    const dashboard = source("components/teacher-dashboard.tsx");
    const matrix = source("components/teacher-attendance-matrix.tsx");
    expect(dashboard).toContain("session.enable_projection_bubbles");
    expect(dashboard).toContain("enableProjectionBubbles: dialog.enableProjectionBubbles");
    expect(matrix).toContain("enableProjectionBubbles: session.enableProjectionBubbles");
    expect(matrix).toContain("enableProjectionBubbles: sessionEdit.enableProjectionBubbles");
  });

  it("polls the authoritative session setting without replaying attendance", () => {
    const projection = source("components/teacher-projection.tsx");
    expect(projection).toContain("setSession(body.session)");
    expect(projection).toContain("session.enable_projection_bubbles");
    expect(projection).not.toContain("setAttendanceBubbles(body.session");
  });
});
