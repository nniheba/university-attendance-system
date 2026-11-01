import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import {
  institutionalEmailAudience,
  normalizeInstitutionalEmail,
} from "@/lib/security/institutional-email";
import {
  forbiddenTeacherResponse,
  requireTeacher,
  teacherOwnsClass,
} from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request) {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request, 2_048);
    const email = normalizeInstitutionalEmail(body?.email);
    if (!email || institutionalEmailAudience(email) !== "student") {
      return jsonError("Indica un correo institucional de estudiante válido.", 400, "INVALID_STUDENT_EMAIL");
    }

    const hasClassContext = Boolean(body && ("classId" in body || "enrollmentId" in body));
    const classId = typeof body?.classId === "string" ? body.classId.trim() : "";
    const enrollmentId = typeof body?.enrollmentId === "string" ? body.enrollmentId.trim() : "";
    if (hasClassContext && (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(enrollmentId))) {
      return jsonError("El contexto de la matrícula no es válido.", 400, "INVALID_RESET_CONTEXT");
    }

    const supabase = createAdminClient();
    let enrollmentUserId: string | null = null;
    if (hasClassContext) {
      if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("class_enrollments")
        .select("student_email, student_user_id")
        .eq("id", enrollmentId)
        .eq("class_id", classId)
        .eq("student_email", email)
        .maybeSingle();
      if (enrollmentError) throw enrollmentError;
      if (!enrollment) {
        return jsonError("El estudiante no pertenece a esta asignatura.", 404, "STUDENT_NOT_IN_CLASS");
      }
      enrollmentUserId = enrollment.student_user_id;
    }

    const { data: account, error: accountError } = await supabase
      .from("institutional_accounts")
      .select("user_id")
      .eq("email", email)
      .eq("role", "student")
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) {
      return jsonError("No existe una cuenta estudiantil para ese correo.", 404, "STUDENT_NOT_FOUND");
    }
    if (enrollmentUserId && enrollmentUserId !== account.user_id) {
      return jsonError("El estudiante no pertenece a esta asignatura.", 404, "STUDENT_NOT_IN_CLASS");
    }

    const { error: resetError } = await supabase.rpc("reset_student_trusted_device", {
      p_subject_user_id: account.user_id,
      p_actor_user_id: auth.user.id,
    });
    if (resetError) throw resetError;

    return jsonNoStore({ ok: true });
  } catch (error) {
    console.error("Could not reset trusted student device", error);
    return jsonError("No se pudo restablecer el dispositivo.", 500, "SERVER_ERROR");
  }
}
