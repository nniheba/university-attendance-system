import { jsonError, jsonNoStore, parseFiniteNumber, readJsonObject } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/server";
import { forbiddenTeacherResponse, requireTeacher } from "@/lib/security/teacher-auth";
import { cleanAcademicLabel } from "@/lib/academic/input";
import { isAcademicColorKey } from "@/lib/academic/colors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request);
    if (!body) return jsonError("Datos no válidos.", 400, "INVALID_INPUT");

    const classId = typeof body.classId === "string" ? body.classId : "";
    if (!/^[0-9a-f-]{36}$/iu.test(classId)) {
      return jsonError("La clase indicada no es válida.", 400, "INVALID_INPUT");
    }
    if (typeof body.allowSelfEnrollment !== "boolean") {
      return jsonError("Indica si esta sesión permite nuevas matrículas.", 400, "INVALID_SELF_ENROLLMENT_POLICY");
    }
    const enableProjectionBubbles = body.enableProjectionBubbles === undefined
      ? true
      : body.enableProjectionBubbles;
    if (typeof enableProjectionBubbles !== "boolean") {
      return jsonError("La preferencia de animación no es válida.", 400, "INVALID_PROJECTION_BUBBLES_SETTING");
    }
    const sessionName = cleanAcademicLabel(body.sessionName);
    if (!sessionName) {
      return jsonError("Indica un nombre de sesión de hasta 120 caracteres.", 400, "INVALID_SESSION_NAME");
    }
    if (!isAcademicColorKey(body.colorKey)) {
      return jsonError("Selecciona un color de sesión válido.", 400, "INVALID_COLOR");
    }
    const admin = createAdminClient();
    const { data: course, error: classError } = await admin
      .from("classes")
      .select("id, status")
      .eq("id", classId)
      .eq("teacher_id", auth.user.id)
      .maybeSingle();
    if (classError) throw classError;
    if (!course) {
      return forbiddenTeacherResponse();
    }
    if (course.status !== "active") {
      return jsonError("No se puede abrir asistencia para una asignatura archivada.", 409, "CLASS_ARCHIVED");
    }

    const useLocation = body.useLocation === true;
    const latitude = parseFiniteNumber(body.latitude);
    const longitude = parseFiniteNumber(body.longitude);
    const allowedRadiusM = parseFiniteNumber(body.allowedRadiusM);
    if (useLocation && (
      latitude === null || latitude < -90 || latitude > 90
      || longitude === null || longitude < -180 || longitude > 180
      || allowedRadiusM === null || allowedRadiusM < 10 || allowedRadiusM > 1_000
    )) {
      return jsonError("La ubicación de referencia no es válida.", 400, "INVALID_LOCATION");
    }

    const { data, error } = await admin
      .from("sessions")
      .insert({
        class_id: classId,
        session_name: sessionName,
        color_key: body.colorKey,
        status: "open",
        latitude: useLocation ? latitude : null,
        longitude: useLocation ? longitude : null,
        allowed_radius_m: useLocation ? Math.round(allowedRadiusM!) : null,
        allow_self_enrollment: body.allowSelfEnrollment,
        enable_projection_bubbles: enableProjectionBubbles,
      })
      .select("id, class_id, session_name, color_key, opened_at, closed_at, status, latitude, longitude, allowed_radius_m, location_city, location_region, location_country, location_country_code, counts_toward_attendance, allow_self_enrollment, enable_projection_bubbles, created_at")
      .single();
    if (error) throw error;
    return jsonNoStore({ ok: true, session: data }, { status: 201 });
  } catch (error) {
    console.error("Could not create session", error);
    return jsonError("No se pudo abrir la asistencia.", 500, "SERVER_ERROR");
  }
}
