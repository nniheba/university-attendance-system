import { enrollmentView } from "@/lib/academic/enrollments";
import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { EnrollmentRecord } from "@/lib/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ classId: string; enrollmentId: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { classId, enrollmentId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request);
    const action = body?.action;
    if (action !== "deactivate" && action !== "reactivate") {
      return jsonError("Acción no válida.", 400, "INVALID_ACTION");
    }
    const admin = createAdminClient();
    const { error: transitionError } = await admin.rpc("set_class_enrollment_status", {
      p_enrollment_id: enrollmentId,
      p_action: action,
      p_actor_user_id: auth.user.id,
      p_student_user_id: null,
    });
    if (transitionError) {
      if (transitionError.message.includes("ENROLLMENT_NOT_FOUND")) {
        return jsonError("Matrícula no encontrada.", 404, "NOT_FOUND");
      }
      throw transitionError;
    }
    const { data, error } = await admin
      .from("class_enrollments")
      .select("*")
      .eq("id", enrollmentId)
      .eq("class_id", classId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonError("Matrícula no encontrada.", 404, "NOT_FOUND");
    return jsonNoStore({ ok: true, student: await enrollmentView(data as EnrollmentRecord) });
  } catch (error) {
    console.error("Could not update class enrollment", error);
    return jsonError("No se pudo actualizar la matrícula.", 500, "SERVER_ERROR");
  }
}
