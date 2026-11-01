import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectionAttendanceBubbles } from "@/components/projection-attendance-bubbles";
import {
  createProjectionAttendanceBubble,
  enqueueProjectionAttendanceBubble,
  PROJECTION_BUBBLE_DURATION_MS,
  PROJECTION_BUBBLE_LIMIT,
} from "@/lib/projection/attendance-bubbles";

const projectionSource = readFileSync(
  new URL("../components/teacher-projection.tsx", import.meta.url),
  "utf8",
);
const projectionCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function bubble(id: string, sequence = 0) {
  return createProjectionAttendanceBubble({
    id,
    student_user_id: sequence % 2 === 0 ? `student-${id}` : null,
    full_name: `Estudiante ${id}`,
  }, sequence);
}

describe("live projection attendance bubbles", () => {
  it("assigns three stable visual lanes and bounds the simultaneous queue", () => {
    const queued = Array.from({ length: 8 }, (_, index) => index).reduce(
      (current, index) => enqueueProjectionAttendanceBubble(current, bubble(String(index), index)),
      [] as ReturnType<typeof bubble>[],
    );

    expect(queued).toHaveLength(PROJECTION_BUBBLE_LIMIT);
    expect(queued.map((item) => item.id)).toEqual(["2", "3", "4", "5", "6", "7"]);
    expect(queued.map((item) => item.lane)).toEqual([2, 0, 1, 2, 0, 1]);
    expect(PROJECTION_BUBBLE_DURATION_MS).toBeGreaterThanOrEqual(3_500);
    expect(PROJECTION_BUBBLE_DURATION_MS).toBeLessThanOrEqual(5_000);
  });

  it("deduplicates the same attendance id without suppressing rapid distinct inserts", () => {
    const first = bubble("a");
    const duplicate = enqueueProjectionAttendanceBubble([first], first);
    const rapid = ["b", "c", "d", "e", "f"].reduce(
      (current, id, index) => enqueueProjectionAttendanceBubble(current, bubble(id, index + 1)),
      duplicate,
    );

    expect(duplicate).toEqual([first]);
    expect(rapid.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("renders only a safe identity summary in an inert overlay", () => {
    const html = renderToStaticMarkup(createElement(ProjectionAttendanceBubbles, {
      bubbles: [bubble("safe")],
    }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("Estudiante safe");
    expect(html).toContain("/avatars/student-profile.svg");
    expect(html).toContain("✓");
    for (const privateField of ["email", "gps", "location", "device", "teacher_note"]) {
      expect(html.toLowerCase()).not.toContain(privateField);
    }
  });

  it("creates bubbles only from new active INSERT events and never replays initial rows", () => {
    expect(projectionSource).toContain("new Set(initialSession.attendance.map((row) => row.id))");
    expect(projectionSource).toContain('payload.eventType === "INSERT" && !row.voided_at');
    expect(projectionSource).toContain("seenBubbleAttendanceIds.current.has(attendance.id)");
    expect(projectionSource).toContain("seenBubbleAttendanceIds.current.add(attendance.id)");
    expect(projectionSource).toContain("projectionBubblesEnabled.current");
  });

  it("isolates the overlay to the attendance panel and memoizes the unified QR surface", () => {
    const attendancePanel = projectionSource.indexOf("<ProjectionAttendanceList");
    const bubbles = projectionSource.indexOf("<ProjectionAttendanceBubbles", attendancePanel);
    expect(attendancePanel).toBeGreaterThan(-1);
    expect(bubbles).toBeGreaterThan(attendancePanel);
    expect(projectionSource.slice(attendancePanel - 200, bubbles + 120)).toContain("relative");
    expect(projectionSource).not.toContain("StaticAccessQr");
    expect(projectionSource).toContain("const ProjectionQr = memo(");
    expect(projectionSource).toContain("const ProjectionClosed = memo(");
  });

  it("uses transform/opacity animation, responsive travel and a reduced-motion fade", () => {
    expect(projectionCss).toContain("@keyframes projection-bubble-flight");
    expect(projectionCss).toContain("will-change: transform, opacity");
    expect(projectionCss).toContain("@media (max-width: 480px)");
    expect(projectionCss).toContain("@media (min-width: 768px)");
    expect(projectionCss).toContain("@media (min-width: 1024px)");
    expect(projectionCss).toContain("@media (min-width: 1366px)");
    expect(projectionCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(projectionCss).toContain("projection-bubble-fade 2.2s");
  });
});
