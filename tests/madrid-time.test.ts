import { describe, expect, it } from "vitest";
import { madridDateTimeInput, madridLocalDateTimeToIso } from "@/lib/academic/madrid-time";

describe("Europe/Madrid session time conversion", () => {
  it("converts winter and summer wall-clock times without hardcoded offsets", () => {
    expect(madridLocalDateTimeToIso("2026-01-15", "18:30")).toBe("2026-01-15T17:30:00.000Z");
    expect(madridLocalDateTimeToIso("2026-09-24", "18:30")).toBe("2026-09-24T16:30:00.000Z");
  });

  it("round-trips persisted UTC timestamps into editable Madrid fields", () => {
    expect(madridDateTimeInput("2026-09-24T16:30:00.000Z")).toEqual({ date: "2026-09-24", time: "18:30" });
    expect(madridDateTimeInput("2026-01-15T17:30:00.000Z")).toEqual({ date: "2026-01-15", time: "18:30" });
  });

  it("rejects invalid calendar values and the DST spring-forward gap", () => {
    expect(madridLocalDateTimeToIso("2026-02-31", "18:30")).toBeNull();
    expect(madridLocalDateTimeToIso("2026-03-29", "02:30")).toBeNull();
    expect(madridLocalDateTimeToIso("not-a-date", "18:30")).toBeNull();
  });
});
