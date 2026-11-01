import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("application identity", () => {
  it("ships a local, legible SVG application icon", () => {
    const icon = new URL("../app/icon.svg", import.meta.url);
    expect(existsSync(icon)).toBe(true);
    const svg = readFileSync(icon, "utf8");
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain("<rect");
    expect(svg).toContain("#1d4ed8");
    expect(svg).toContain('stroke="#fff"');
  });

  it("uses the requested institutional metadata and local icon", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('title: "Campus Attendance"');
    expect(layout).toContain('applicationName: "Campus Attendance"');
    expect(layout).toContain('description: "Sistema universitario de gestión y registro de asistencia."');
    expect(layout).toContain('icon: "/icon.svg"');
  });
});
