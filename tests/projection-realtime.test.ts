import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ProjectionAttendanceList,
  projectionRecentAttendance,
  studentInitials,
} from "@/components/projection-attendance-list";
import { mergeAttendanceRecord } from "@/lib/attendance/merge";
import type { AttendanceRecord } from "@/lib/types";

function record(id: string, name: string, registeredAt: string, studentUserId: string | null = null): AttendanceRecord {
  return {
    id,
    session_id: "session-a",
    student_user_id: studentUserId,
    full_name: name,
    normalized_name: name.toLowerCase(),
    registered_at: registeredAt,
    qr_verified: true,
    location_verified: true,
    location_accuracy: 999,
    distance_from_center_m: 888,
    network_city: "SECRET_CITY",
    network_region: "SECRET_REGION",
    network_country: "SECRET_COUNTRY",
    network_country_code: "ZZ",
    network_location_status: "mismatch",
    source: "qr",
    student_email_snapshot: "student@students.example.edu",
    review_status: "normal",
    teacher_note: null,
    manual_reason: null,
    created_by: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    gps_status: "verified",
    created_at: registeredAt,
  };
}

describe("projection Realtime state", () => {
  it("authenticates Realtime before subscribing to attendance changes", () => {
    const source = readFileSync(new URL("../components/teacher-dashboard.tsx", import.meta.url), "utf8");
    const setAuth = source.indexOf("supabase.realtime.setAuth(data.session.access_token)");
    const subscribe = source.indexOf("channel.subscribe()", setAuth);

    expect(setAuth).toBeGreaterThan(-1);
    expect(subscribe).toBeGreaterThan(setAuth);
  });

  it("merges INSERT records once and keeps chronological order", () => {
    const second = record("b", "Beatriz", "2026-09-21T10:02:00.000Z");
    const first = record("a", "Ana", "2026-09-21T10:01:00.000Z");
    const initial = mergeAttendanceRecord([], second);
    const sorted = mergeAttendanceRecord(initial.attendance, first);
    const duplicate = mergeAttendanceRecord(sorted.attendance, second);

    expect(initial.inserted).toBe(true);
    expect(sorted.attendance.map((item) => item.id)).toEqual(["a", "b"]);
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.attendance).toBe(sorted.attendance);
  });

  it("renders linked profile icons, historical initials and queued row animations", () => {
    const attendance = [
      record("a", "Ana García", "2026-09-21T10:01:00.000Z", "student-a"),
      record("b", "Beatriz López", "2026-09-21T10:02:00.000Z"),
    ];
    const html = renderToStaticMarkup(createElement(ProjectionAttendanceList, {
      attendance,
      recentAttendanceIds: ["a", "b"],
    }));

    expect(html).toContain("Presentes: 2");
    expect(html).toContain("Ana García");
    expect(html).toContain("Beatriz López");
    expect(html).toContain("/avatars/student-profile.svg");
    expect(html).not.toContain(">AG<");
    expect(html).toContain("BL");
    expect(html.match(/projection-attendance-entry/gu)).toHaveLength(2);
  });

  it("marks a QR-verified v0.5.1 row as valid without GPS", () => {
    const fastRecord = { ...record("fast", "Nicolás Herrera", "2026-09-21T10:03:00.000Z"), location_verified: false, location_accuracy: null, distance_from_center_m: null };
    const html = renderToStaticMarkup(createElement(ProjectionAttendanceList, {
      attendance: [fastRecord],
      recentAttendanceIds: ["fast"],
    }));
    expect(html).toContain("Asistencia registrada");
    expect(html).toContain("✓");
  });

  it("does not expose network or precise-location metadata", () => {
    const html = renderToStaticMarkup(createElement(ProjectionAttendanceList, {
      attendance: [record("a", "Ana García", "2026-09-21T10:01:00.000Z")],
      recentAttendanceIds: [],
    }));

    for (const sensitive of [
      "SECRET_CITY",
      "SECRET_REGION",
      "SECRET_COUNTRY",
      "network_city",
      "network_country",
      "location_accuracy",
      "distance_from_center_m",
      "device_hash",
      "999",
      "888",
    ]) {
      expect(html).not.toContain(sensitive);
    }
  });

  it("keeps a bounded newest-first feed with stable initials", () => {
    const attendance = Array.from({ length: 10 }, (_, index) => record(
      String(index),
      `Estudiante ${index}`,
      `2026-09-21T10:${String(index).padStart(2, "0")}:00.000Z`,
    ));
    const recent = projectionRecentAttendance(attendance);
    expect(recent).toHaveLength(8);
    expect(recent.map((item) => item.id)).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
    expect(studentInitials("  Ana María García  ")).toBe("AM");
  });

  it("animates only realtime INSERT events in the projection controller", () => {
    const source = readFileSync(new URL("../components/teacher-projection.tsx", import.meta.url), "utf8");
    expect(source).toContain('payload.eventType === "INSERT"');
    expect(source).toContain("animateAttendance(row.id)");
    expect(source).toContain("recentAttendanceIds={recentAttendanceIds}");
  });
});
