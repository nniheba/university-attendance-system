import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/server";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsSession } from "@/lib/security/teacher-auth";
import { sessionAttendanceCsv, sessionCsvFilename } from "@/lib/academic/session-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();
    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, session_name, opened_at, deleted_at, class:classes(name, group_name, academic_year)")
      .eq("id", id)
      .single();
    if (sessionError || !session) return jsonError("Sesión no encontrada.", 404, "NOT_FOUND");
    if (session.deleted_at) {
      return jsonError("La sesión fue eliminada de la matriz.", 404, "SESSION_REMOVED");
    }
    const attendanceResult = await supabase
      .from("attendance")
      .select("full_name, student_email_snapshot, registered_at, source, review_status, gps_status")
      .eq("session_id", id)
      .is("voided_at", null)
      .order("registered_at", { ascending: true });
    const classRelation = Array.isArray(session.class) ? session.class[0] : session.class;
    if (!classRelation || attendanceResult.error) throw attendanceResult.error ?? new Error("CLASS_NOT_FOUND");
    const csvContext = {
      sessionName: session.session_name,
      openedAt: session.opened_at,
      course: {
        name: classRelation.name,
        groupName: classRelation.group_name,
        academicYear: classRelation.academic_year,
      },
    };
    const csv = sessionAttendanceCsv(csvContext, attendanceResult.data ?? []);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sessionCsvFilename(csvContext)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Could not export attendance", error);
    return jsonError("No se pudo exportar el CSV.", 500, "SERVER_ERROR");
  }
}
