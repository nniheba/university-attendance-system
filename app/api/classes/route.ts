import { createAdminClient } from "@/lib/supabase/server";
import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { requireTeacher } from "@/lib/security/teacher-auth";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";
import { cleanAcademicLabel, cleanOptionalAcademicLabel } from "@/lib/academic/input";
import { getTeacherClassSummaries } from "@/lib/academic/teacher-statistics";
import type { ClassRecord, ClassSummary } from "@/lib/types";
import { isAcademicColorKey } from "@/lib/academic/colors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const admin = createAdminClient();
    const { data: classes, error } = await admin
      .from("classes")
      .select("id, name, teacher_name, teacher_id, group_name, academic_year, status, enrollment_mode, color_key, updated_at, archived_at, created_at")
      .eq("teacher_id", auth.user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false });
    if (error) throw error;

    const summaries: ClassSummary[] = await getTeacherClassSummaries(classes as ClassRecord[]);
    return jsonNoStore({ ok: true, classes: summaries });
  } catch (error) {
    console.error("Could not read classes", error);
    return jsonError("No se pudieron cargar las asignaturas.", 500, "SERVER_ERROR");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request);
    if (!body) return jsonError("Datos no válidos.", 400, "INVALID_INPUT");
    const name = cleanAcademicLabel(body.name);
    const groupName = cleanOptionalAcademicLabel(body.groupName, 80);
    const academicYear = cleanOptionalAcademicLabel(body.academicYear, 40);
    const enrollmentMode = body.enrollmentMode;
    const colorKey = body.colorKey;
    if (!name) {
      return jsonError(
        "Indica el nombre de la asignatura.",
        400,
        "INVALID_INPUT",
      );
    }
    if (groupName === undefined || academicYear === undefined) {
      return jsonError("Los datos académicos no son válidos.", 400, "INVALID_INPUT");
    }
    if (enrollmentMode !== "closed" && enrollmentMode !== "self_enroll") {
      return jsonError("Selecciona una política de matrícula válida.", 400, "INVALID_ENROLLMENT_MODE");
    }
    if (!isAcademicColorKey(colorKey)) {
      return jsonError("Selecciona un color de asignatura válido.", 400, "INVALID_COLOR");
    }
    const profile = await getOrCreateTeacherProfile(auth.user);

    const { data, error } = await createAdminClient()
      .from("classes")
      .insert({
        name,
        teacher_name: profile.display_name,
        teacher_id: auth.user.id,
        group_name: groupName,
        academic_year: academicYear,
        enrollment_mode: enrollmentMode,
        color_key: colorKey,
        status: "active",
      })
      .select("id, name, teacher_name, teacher_id, group_name, academic_year, status, enrollment_mode, color_key, updated_at, archived_at, created_at")
      .single();
    if (error) throw error;
    return jsonNoStore({ ok: true, class: data }, { status: 201 });
  } catch (error) {
    console.error("Could not create class", error);
    return jsonError("No se pudo crear la clase.", 500, "SERVER_ERROR");
  }
}
