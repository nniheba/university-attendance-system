import { notFound, redirect } from "next/navigation";

import { TeacherProjection } from "@/components/teacher-projection";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { teacherOwnsSession } from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { SessionView } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) redirect("/login");
  if (identity.identity.account.role !== "teacher") redirect("/student");
  if (!(await teacherOwnsSession(sessionId, identity.identity.user.id))) notFound();

  const supabase = createAdminClient();
  const [{ data: session, error: sessionError }, { data: attendance, error: attendanceError }] = await Promise.all([
    supabase.from("sessions").select(`
      id, class_id, session_name, color_key, opened_at, closed_at, status, latitude, longitude,
      allowed_radius_m, location_city, location_region, location_country,
      location_country_code, counts_toward_attendance, allow_self_enrollment,
      enable_projection_bubbles, created_at,
      class:classes(id, name, teacher_name, teacher_id, group_name, academic_year, status, enrollment_mode, color_key, updated_at, archived_at, created_at)
    `).eq("id", sessionId).is("deleted_at", null).single(),
    supabase.from("attendance").select(`
      id, session_id, student_user_id, full_name, normalized_name, registered_at,
      qr_verified, location_verified, location_accuracy, distance_from_center_m,
      network_city, network_region, network_country, network_country_code,
      network_location_status, source, student_email_snapshot, review_status,
      teacher_note, manual_reason, created_by, voided_at, voided_by, void_reason,
      gps_status, created_at
    `).eq("session_id", sessionId).is("voided_at", null).order("registered_at", { ascending: true }),
  ]);
  if (sessionError || attendanceError || !session) notFound();
  const course = Array.isArray(session.class) ? session.class[0] : session.class;
  if (!course) notFound();

  return <TeacherProjection initialSession={{ ...session, class: course, attendance: attendance ?? [] } as unknown as SessionView} />;
}
