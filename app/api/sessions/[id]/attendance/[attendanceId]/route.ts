import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import {
  forbiddenTeacherResponse,
  requireTeacher,
  teacherOwnsSession,
} from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; attendanceId: string }>;
}

const ACTIONS = new Set(["mark_suspicious", "clear_suspicious", "update_note", "void"]);

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, attendanceId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();

    const body = await readJsonObject(request, 4_096);
    const action = typeof body?.action === "string" ? body.action : "";
    if (!ACTIONS.has(action)) return jsonError("Acción no válida.", 400, "INVALID_ACTION");
    const rawValue = action === "update_note" ? body?.note : body?.reason;
    const value = typeof rawValue === "string" ? rawValue.trim() : null;
    if (value !== null && value.length > 500) {
      return jsonError("El texto no puede superar 500 caracteres.", 400, "VALUE_TOO_LONG");
    }
    if (action === "void" && !value) {
      return jsonError("Indica el motivo de la eliminación.", 400, "VOID_REASON_REQUIRED");
    }

    const supabase = createAdminClient();
    const databaseAction = action === "update_note" ? "note_update" : action;
    const { error: updateError } = await supabase.rpc("moderate_attendance", {
      p_session_id: id,
      p_attendance_id: attendanceId,
      p_action: databaseAction,
      p_value: value,
      p_actor_user_id: auth.user.id,
    });
    if (updateError) {
      if (updateError.message === "ATTENDANCE_NOT_FOUND") {
        return jsonError("Asistencia no encontrada.", 404, "NOT_FOUND");
      }
      if (updateError.message === "ATTENDANCE_VOIDED") {
        return jsonError("La asistencia ya fue anulada.", 409, "ATTENDANCE_VOIDED");
      }
      throw updateError;
    }

    const { data: attendance, error: readError } = await supabase
      .from("attendance")
      .select("*")
      .eq("id", attendanceId)
      .eq("session_id", id)
      .single();
    if (readError || !attendance) throw readError ?? new Error("ATTENDANCE_NOT_FOUND");
    return jsonNoStore({ ok: true, attendance });
  } catch (error) {
    console.error("Could not moderate attendance", error);
    return jsonError("No se pudo actualizar la asistencia.", 500, "SERVER_ERROR");
  }
}
