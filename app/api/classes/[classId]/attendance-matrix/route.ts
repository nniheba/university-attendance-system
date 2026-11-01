import { getTeacherAttendanceMatrix } from "@/lib/academic/attendance-matrix";
import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { StudentAttendanceStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

const OVERRIDE_STATUSES = new Set<StudentAttendanceStatus>(["present", "absent", "suspicious"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function databaseFailure(error: { message?: string }) {
  if (error.message === "SESSION_NOT_ELIGIBLE_FOR_STUDENT") {
    return jsonError("Esta sesión no corresponde al periodo de matrícula del estudiante.", 409, error.message);
  }
  if (error.message === "INVALID_OVERRIDE_RELATION") {
    return jsonError("La sesión y la matrícula no pertenecen a la misma asignatura.", 400, error.message);
  }
  if (error.message === "SESSION_NOT_COMPUTABLE") {
    return jsonError("Solo se pueden corregir sesiones cerradas y computables.", 409, error.message);
  }
  if (error.message === "OVERRIDE_NOT_FOUND") {
    return jsonError("La corrección ya no existe.", 404, error.message);
  }
  if (error.message === "FORBIDDEN") return forbiddenTeacherResponse();
  if (error.message === "INVALID_OVERRIDE_STATUS" || error.message === "INVALID_OVERRIDE_REASON") {
    return jsonError("La corrección no es válida.", 400, error.message);
  }
  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const matrix = await getTeacherAttendanceMatrix(classId);
    if (!matrix) return jsonError("Asignatura no encontrada.", 404, "NOT_FOUND");
    return jsonNoStore({ ok: true, matrix });
  } catch (error) {
    console.error("Could not read attendance matrix", error);
    return jsonError("No se pudo cargar la matriz de asistencia.", 500, "SERVER_ERROR");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request, 4_096);
    const action = body?.action;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const enrollmentId = typeof body?.enrollmentId === "string" ? body.enrollmentId : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 500) {
      return jsonError("Indica un motivo de entre 1 y 500 caracteres.", 400, "INVALID_OVERRIDE_REASON");
    }
    if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(enrollmentId)) {
      return jsonError("La sesión o la matrícula no son válidas.", 400, "INVALID_OVERRIDE_TARGET");
    }

    const admin = createAdminClient();
    let result: Awaited<ReturnType<typeof admin.rpc>>;
    if (action === "set_status") {
      const status = typeof body?.status === "string" ? body.status as StudentAttendanceStatus : null;
      if (!status || !OVERRIDE_STATUSES.has(status)) {
        return jsonError("Selecciona un estado válido.", 400, "INVALID_OVERRIDE_STATUS");
      }
      result = await admin.rpc("set_attendance_override", {
        p_class_id: classId,
        p_session_id: sessionId,
        p_enrollment_id: enrollmentId,
        p_status: status,
        p_reason: reason,
        p_actor_user_id: auth.user.id,
      });
    } else if (action === "clear_override") {
      result = await admin.rpc("clear_attendance_override", {
        p_class_id: classId,
        p_session_id: sessionId,
        p_enrollment_id: enrollmentId,
        p_reason: reason,
        p_actor_user_id: auth.user.id,
      });
    } else {
      return jsonError("Acción no válida.", 400, "INVALID_ACTION");
    }
    if (result.error) {
      const response = databaseFailure(result.error);
      if (response) return response;
      throw result.error;
    }
    const matrix = await getTeacherAttendanceMatrix(classId);
    return jsonNoStore({ ok: true, matrix });
  } catch (error) {
    console.error("Could not update attendance override", error);
    return jsonError("No se pudo guardar la corrección.", 500, "SERVER_ERROR");
  }
}
