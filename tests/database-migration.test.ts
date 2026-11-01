import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/202609210001_attendance_alpha.sql",
  import.meta.url,
);

describe("database integrity migration", () => {
  it("enforces one normalized name per session", () => {
    const migration = readFileSync(migrationUrl, "utf8");
    expect(migration).toMatch(/unique\s*\(session_id,\s*normalized_name\)/iu);
    expect(migration).toContain("register_attendance_if_open");
  });
});
