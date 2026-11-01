import { cleanAcademicLabel, cleanOptionalAcademicLabel } from "@/lib/academic/input";
import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getTeacherClassSummaries } from "@/lib/academic/teacher-statistics";
import type { ClassRecord } from "@/lib/types";
import { isAcademicColorKey } from "@/lib/academic/colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

async function classSummary(classId: string, teacherId: string) {
  const admin = createAdminClient();
  const { data: course, error } = await admin.from("classes")
    .select("id, name, teacher_name, teacher_id, group_name, academic_year, status, enrollment_mode, color_key, updated_at, archived_at, created_at")
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (error) throw error;
  if (!course) return null;
  const [summary] = await getTeacherClassSummaries([course as ClassRecord]);
  return summary;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const course = await classSummary(classId, auth.user.id);
    if (!course) return jsonError("Asignatura no encontrada.", 404, "NOT_FOUND");
    return jsonNoStore({ ok: true, class: course });
  } catch (error) {
    console.error("Could not read class", error);
    return jsonError("No se pudo cargar la asignatura.", 500, "SERVER_ERROR");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request);
    const action = body?.action;
    const admin = createAdminClient();
    let changes: Record<string, unknown>;

    if (action === "archive") {
      changes = { status: "archived", archived_at: new Date().toISOString() };
    } else if (action === "restore") {
      changes = { status: "active", archived_at: null };
    } else if (action === "update_details") {
      const name = cleanAcademicLabel(body?.name);
      const groupName = cleanOptionalAcademicLabel(body?.groupName, 80);
      const academicYear = cleanOptionalAcademicLabel(body?.academicYear, 40);
      const enrollmentMode = body?.enrollmentMode;
      const colorKey = body?.colorKey;
      if (!name || groupName === undefined || academicYear === undefined
        || (enrollmentMode !== "closed" && enrollmentMode !== "self_enroll")
        || !isAcademicColorKey(colorKey)) {
        return jsonError("Los datos académicos no son válidos.", 400, "INVALID_INPUT");
      }
      changes = { name, group_name: groupName, academic_year: academicYear, enrollment_mode: enrollmentMode, color_key: colorKey };
    } else {
      return jsonError("Acción no válida.", 400, "INVALID_ACTION");
    }

    const { data, error } = await admin.from("classes")
      .update(changes)
      .eq("id", classId)
      .eq("teacher_id", auth.user.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonError("Asignatura no encontrada.", 404, "NOT_FOUND");
    const course = await classSummary(classId, auth.user.id);
    return jsonNoStore({ ok: true, class: course });
  } catch (error) {
    console.error("Could not update class", error);
    return jsonError("No se pudo actualizar la asignatura.", 500, "SERVER_ERROR");
  }
}
