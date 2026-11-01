import { enrollmentView, enrollmentViews, linkedStudentUserId, normalizeStudentEnrollmentEmail } from "@/lib/academic/enrollments";
import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { EnrollmentRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const { data, error } = await createAdminClient()
      .from("class_enrollments")
      .select("id, class_id, student_email, student_user_id, status, enrolled_at, unenrolled_at, created_by, created_at, updated_at")
      .eq("class_id", classId)
      .order("student_email", { ascending: true });
    if (error) throw error;
    const students = await enrollmentViews(data as EnrollmentRecord[]);
    return jsonNoStore({ ok: true, students });
  } catch (error) {
    console.error("Could not read class enrollments", error);
    return jsonError("No se pudo cargar el alumnado.", 500, "SERVER_ERROR");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const body = await readJsonObject(request);
    const email = normalizeStudentEnrollmentEmail(body?.email);
    if (!email) {
      return jsonError("Indica un correo @students.example.edu válido.", 400, "INVALID_STUDENT_EMAIL");
    }

    const admin = createAdminClient();
    const { data: course, error: classError } = await admin
      .from("classes")
      .select("status")
      .eq("id", classId)
      .eq("teacher_id", auth.user.id)
      .single();
    if (classError || !course) throw classError ?? new Error("CLASS_NOT_FOUND");
    if (course.status !== "active") {
      return jsonError("Restaura la asignatura antes de matricular estudiantes.", 409, "CLASS_ARCHIVED");
    }

    const studentUserId = await linkedStudentUserId(email);
    const { data: existing, error: existingError } = await admin
      .from("class_enrollments")
      .select("id, class_id, student_email, student_user_id, status, enrolled_at, unenrolled_at, created_by, created_at, updated_at")
      .eq("class_id", classId)
      .eq("student_email", email)
      .maybeSingle();
    if (existingError) throw existingError;

    const { data: enrollmentId, error: enrollmentError } = await admin.rpc("enroll_class_student", {
      p_class_id: classId,
      p_student_email: email,
      p_student_user_id: studentUserId,
      p_actor_user_id: auth.user.id,
    });
    if (enrollmentError) throw enrollmentError;

    const { data, error } = await admin
      .from("class_enrollments")
      .select("id, class_id, student_email, student_user_id, status, enrolled_at, unenrolled_at, created_by, created_at, updated_at")
      .eq("id", enrollmentId)
      .single();
    if (error) throw error;
    const enrollment = data as EnrollmentRecord;
    return jsonNoStore({ ok: true, student: await enrollmentView(enrollment) }, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error("Could not create class enrollment", error);
    return jsonError("No se pudo matricular al estudiante.", 500, "SERVER_ERROR");
  }
}
