import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import {
  deriveInstitutionalDisplayName,
  institutionalEmailAudience,
  normalizeInstitutionalEmail,
} from "@/lib/security/institutional-email";
import {
  forbiddenTeacherResponse,
  requireTeacher,
  teacherOwnsSession,
} from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();

    const body = await readJsonObject(request, 4_096);
    const email = normalizeInstitutionalEmail(body?.email);
    const reason = typeof body?.reason === "string"
      ? body.reason.trim().replace(/\s+/gu, " ")
      : "";
    if (!email || institutionalEmailAudience(email) !== "student") {
      return jsonError("Indica un correo institucional de estudiante válido.", 400, "INVALID_STUDENT_EMAIL");
    }
    if (!reason || reason.length > 500) {
      return jsonError("Indica un motivo de hasta 500 caracteres.", 400, "INVALID_REASON");
    }

    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("class_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (sessionError || !session) throw sessionError ?? new Error("SESSION_NOT_FOUND");
    const { data: enrollment, error: enrollmentError } = await supabase
      .from("class_enrollments")
      .select("id, student_user_id")
      .eq("class_id", session.class_id)
      .eq("student_email", email)
      .eq("status", "active")
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    if (!enrollment) {
      return jsonError("No estás matriculado en esta asignatura.", 403, "STUDENT_NOT_ENROLLED");
    }
    const { data: account, error: accountError } = await supabase
      .from("institutional_accounts")
      .select("user_id")
      .eq("email", email)
      .eq("role", "student")
      .maybeSingle();
    if (accountError) throw accountError;
    if (account && !enrollment.student_user_id) {
      const { error: linkError } = await supabase
        .from("class_enrollments")
        .update({ student_user_id: account.user_id })
        .eq("id", enrollment.id)
        .is("student_user_id", null);
      if (linkError) throw linkError;
    }
    if (account && enrollment.student_user_id && enrollment.student_user_id !== account.user_id) {
      return jsonError("La matrícula no corresponde a esa cuenta.", 409, "ENROLLMENT_IDENTITY_MISMATCH");
    }

    let fullName = deriveInstitutionalDisplayName(email);
    if (account) {
      const { data: profile, error: profileError } = await supabase
        .from("student_profiles")
        .select("display_name")
        .eq("user_id", account.user_id)
        .single();
      if (profileError || !profile) throw profileError ?? new Error("STUDENT_PROFILE_NOT_FOUND");
      fullName = profile.display_name;
    }
    if (!fullName) return jsonError("No se pudo identificar al estudiante.", 400, "INVALID_STUDENT_EMAIL");

    const { data: attendanceId, error: insertError } = await supabase.rpc(
      "add_manual_attendance",
      {
        p_session_id: id,
        p_student_user_id: account?.user_id ?? null,
        p_student_email: email,
        p_full_name: fullName,
        p_normalized_name: fullName.trim().replace(/\s+/gu, " ").toLocaleLowerCase("es-ES"),
        p_manual_reason: reason,
        p_actor_user_id: auth.user.id,
      },
    );
    if (insertError) {
      if (insertError.message === "DUPLICATE_ATTENDANCE" || insertError.code === "23505") {
        return jsonError("El estudiante ya tiene una asistencia activa en esta sesión.", 409, "DUPLICATE_ATTENDANCE");
      }
      if (insertError.message === "SESSION_CLOSED") {
        return jsonError("La sesión ya está cerrada.", 409, "SESSION_CLOSED");
      }
      if (insertError.message === "STUDENT_NOT_ENROLLED") {
        return jsonError("No estás matriculado en esta asignatura.", 403, "STUDENT_NOT_ENROLLED");
      }
      throw insertError;
    }

    const { data: attendance, error: readError } = await supabase
      .from("attendance")
      .select("*")
      .eq("id", attendanceId)
      .single();
    if (readError || !attendance) throw readError ?? new Error("ATTENDANCE_NOT_FOUND");
    return jsonNoStore({ ok: true, attendance }, { status: 201 });
  } catch (error) {
    console.error("Could not add manual attendance", error);
    return jsonError("No se pudo añadir la asistencia manual.", 500, "SERVER_ERROR");
  }
}
