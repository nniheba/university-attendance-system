import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  MOTIVATIONAL_PHRASES,
  motivationalPhraseFor,
} from "@/lib/content/motivational-phrases";

describe("student success experience", () => {
  it("provides at least 50 unique, concise Spanish messages with inspiration attribution", () => {
    expect(MOTIVATIONAL_PHRASES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(MOTIVATIONAL_PHRASES.map((phrase) => phrase.message)).size).toBe(MOTIVATIONAL_PHRASES.length);
    for (const phrase of MOTIVATIONAL_PHRASES) {
      expect(phrase.message.length).toBeGreaterThan(20);
      expect(phrase.message.length).toBeLessThanOrEqual(110);
      expect(phrase.inspiration.length).toBeGreaterThan(2);
    }
  });

  it("selects a stable phrase locally from the supplied seed", () => {
    const first = motivationalPhraseFor("student:attendance-a");
    expect(motivationalPhraseFor("student:attendance-a")).toEqual(first);
    expect(MOTIVATIONAL_PHRASES).toContain(first);
  });

  it("uses a lightweight ripple, an attributed phrase and reduced-motion styles", () => {
    const experience = readFileSync(new URL("../components/attendance-success-experience.tsx", import.meta.url), "utf8");
    const attendance = readFileSync(new URL("../components/student-attendance.tsx", import.meta.url), "utf8");
    const scanner = readFileSync(new URL("../components/student-scanner.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(experience).toContain('duplicate ? "" : "success-ripple-active"');
    expect(experience).toContain("motivation.message");
    expect(experience).toContain("Inspirado en");
    expect(experience).toContain("duplicate ? null : motivationalPhraseFor");
    expect(attendance).toContain("<AttendanceSuccessExperience");
    expect(scanner).toContain("<AttendanceSuccessExperience");
    expect(scanner).toContain('duplicate={phase === "duplicate"}');
    expect(styles).toContain("@keyframes success-ripple");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain(".success-ripple-ring");
    expect(styles).toContain("animation: success-ripple 1.4s");
  });
});
