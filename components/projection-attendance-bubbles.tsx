import { ProjectionStudentAvatar } from "@/components/projection-attendance-list";
import type { ProjectionAttendanceBubble } from "@/lib/projection/attendance-bubbles";

export function ProjectionAttendanceBubbles({
  bubbles,
}: {
  bubbles: readonly ProjectionAttendanceBubble[];
}) {
  if (bubbles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="projection-bubble-layer pointer-events-none absolute inset-0 z-10 overflow-hidden"
      data-testid="projection-bubble-layer"
    >
      {bubbles.map((bubble) => (
        <div
          key={bubble.id}
          className={`projection-attendance-bubble projection-attendance-bubble-lane-${bubble.lane}`}
          data-attendance-id={bubble.id}
        >
          <ProjectionStudentAvatar
            studentUserId={bubble.student_user_id}
            fullName={bubble.full_name}
            className="size-10 shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--campus-navy)]">
            {bubble.full_name}
          </span>
          <span className="text-lg font-bold text-[var(--campus-success)]">✓</span>
        </div>
      ))}
    </div>
  );
}
