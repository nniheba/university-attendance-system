import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/server";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsSession } from "@/lib/security/teacher-auth";
import { cleanAcademicLabel } from "@/lib/academic/input";
import { isAcademicColorKey } from "@/lib/academic/colors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SESSION_COLUMNS = "id, class_id, session_name, color_key, opened_at, closed_at, status, latitude, longitude, allowed_radius_m, location_city, location_region, location_country, location_country_code, counts_toward_attendance, allow_self_enrollment, enable_projection_bubbles, created_at";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();
    const supabase = createAdminClient();
    const { data: session, error } = await supabase
      .from("sessions")
      .select(`${SESSION_COLUMNS}, class:classes(id, name, teacher_name, teacher_id, group_name, academic_year, status, enrollment_mode, color_key, updated_at, archived_at, created_at)`)
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (error || !session) return jsonError("Sesión no encontrada.", 404, "NOT_FOUND");

    const { data: attendance, error: attendanceError } = await supabase
      .from("attendance")
      .select("id, session_id, student_user_id, full_name, normalized_name, registered_at, qr_verified, location_verified, location_accuracy, distance_from_center_m, network_city, network_region, network_country, network_country_code, network_location_status, source, student_email_snapshot, review_status, teacher_note, manual_reason, created_by, voided_at, voided_by, void_reason, gps_status, created_at")
      .eq("session_id", id)
      .is("voided_at", null)
      .order("registered_at", { ascending: true });
    if (attendanceError) throw attendanceError;
    return jsonNoStore({ ok: true, session: { ...session, attendance } });
  } catch (error) {
    console.error("Could not read session", error);
    return jsonError("No se pudo cargar la sesión.", 500, "SERVER_ERROR");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request, 1_024);
    if (!body || typeof body !== "object" || !("action" in body)) {
      return jsonError("Acción no válida.", 400, "INVALID_INPUT");
    }

    const admin = createAdminClient();

    if (body.action === "update_details") {
      const sessionName = cleanAcademicLabel(body.sessionName);
      const openedAtValue = typeof body.openedAt === "string" ? body.openedAt : "";
      const openedAt = openedAtValue ? new Date(openedAtValue) : null;
      if (!sessionName) {
        return jsonError("Indica un nombre de sesión de hasta 120 caracteres.", 400, "INVALID_SESSION_NAME");
      }
      if (!isAcademicColorKey(body.colorKey)) {
        return jsonError("Selecciona un color de sesión válido.", 400, "INVALID_COLOR");
      }
      if (!openedAt || !Number.isFinite(openedAt.getTime()) || openedAt.toISOString() !== openedAtValue) {
        return jsonError("Indica una fecha y hora válidas.", 400, "INVALID_SESSION_TIMESTAMP");
      }
      if (body.enableProjectionBubbles !== undefined && typeof body.enableProjectionBubbles !== "boolean") {
        return jsonError("La preferencia de animación no es válida.", 400, "INVALID_PROJECTION_BUBBLES_SETTING");
      }

      const { data, error } = await admin.rpc("update_session_details_with_projection", {
        p_session_id: id,
        p_session_name: sessionName,
        p_opened_at: openedAt.toISOString(),
        p_color_key: body.colorKey,
        p_enable_projection_bubbles: body.enableProjectionBubbles ?? null,
        p_actor_user_id: auth.user.id,
      });
      if (error) {
        if (error.message === "INVALID_SESSION_TIME_RANGE") {
          return jsonError("La hora de inicio debe ser anterior al cierre de la sesión.", 409, error.message);
        }
        if (error.message === "SESSION_NOT_FOUND") {
          return jsonError("Sesión no encontrada.", 404, error.message);
        }
        if (error.message === "SESSION_REMOVED") {
          return jsonError("La sesión fue eliminada de la matriz.", 404, error.message);
        }
        if (error.message === "FORBIDDEN") return forbiddenTeacherResponse();
        if (["INVALID_SESSION_NAME", "INVALID_SESSION_COLOR", "INVALID_SESSION_TIMESTAMP"].includes(error.message)) {
          return jsonError("Los datos de la sesión no son válidos.", 400, error.message);
        }
        throw error;
      }
      const session = Array.isArray(data) ? data[0] : data;
      return jsonNoStore({ ok: true, session });
    }

    if (body.action !== "close") {
      return jsonError("Acción no válida.", 400, "INVALID_INPUT");
    }

    const closedAt = new Date().toISOString();
    const { data, error } = await admin
      .from("sessions")
      .update({ status: "closed", closed_at: closedAt })
      .eq("id", id)
      .eq("status", "open")
      .is("deleted_at", null)
      .select(SESSION_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonError("La sesión ya estaba cerrada.", 409, "SESSION_CLOSED");
    return jsonNoStore({ ok: true, session: data });
  } catch (error) {
    console.error("Could not close session", error);
    return jsonError("No se pudo cerrar la asistencia.", 500, "SERVER_ERROR");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request, 1_024);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 500) {
      return jsonError("Indica un motivo de eliminación de hasta 500 caracteres.", 400, "INVALID_DELETE_REASON");
    }

    const { error } = await createAdminClient().rpc("remove_attendance_session", {
      p_session_id: id,
      p_reason: reason,
      p_actor_user_id: auth.user.id,
    });
    if (error) {
      if (error.message.includes("SESSION_NOT_FOUND")) {
        return jsonError("Sesión no encontrada.", 404, "SESSION_NOT_FOUND");
      }
      if (error.message.includes("SESSION_STILL_OPEN")) {
        return jsonError("Cierra la asistencia antes de eliminar esta sesión.", 409, "SESSION_STILL_OPEN");
      }
      if (error.message.includes("SESSION_NOT_COMPUTABLE")) {
        return jsonError("Esta sesión no forma parte de los cálculos académicos.", 409, "SESSION_NOT_COMPUTABLE");
      }
      if (error.message.includes("SESSION_ALREADY_REMOVED")) {
        return jsonError("Esta sesión ya fue eliminada de la matriz.", 409, "SESSION_ALREADY_REMOVED");
      }
      if (error.message.includes("FORBIDDEN")) return forbiddenTeacherResponse();
      if (error.message.includes("INVALID_DELETE_REASON")) {
        return jsonError("El motivo de eliminación no es válido.", 400, "INVALID_DELETE_REASON");
      }
      throw error;
    }
    return jsonNoStore({ ok: true });
  } catch (error) {
    console.error("Could not remove attendance session", error);
    return jsonError("No se pudo eliminar la sesión de la matriz.", 500, "SERVER_ERROR");
  }
}
