import { ACADEMIC_COLORS, type AcademicColorKey } from "@/lib/academic/colors";

export function AcademicColorPicker({
  legend,
  name,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  value: AcademicColorKey;
  onChange: (value: AcademicColorKey) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-[var(--campus-navy)]">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {ACADEMIC_COLORS.map((color) => {
          const selected = color.key === value;
          return (
            <label
              key={color.key}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] border bg-white px-3 text-sm font-medium text-[var(--campus-navy)] ${selected ? `${color.selectedClass} ring-1` : "border-[var(--campus-border)] hover:bg-[var(--campus-neutral-100)]"}`}
            >
              <input
                type="radio"
                name={name}
                value={color.key}
                checked={selected}
                onChange={() => onChange(color.key)}
                className="sr-only"
              />
              <span aria-hidden="true" className={`size-3 rounded-full ${color.markerClass}`} />
              {color.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
