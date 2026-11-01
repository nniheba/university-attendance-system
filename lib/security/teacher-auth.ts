import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/http";
export { requireTeacher } from "@/lib/security/institutional-auth";

export async function teacherOwnsClass(classId: string, teacherId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function teacherOwnsSession(sessionId: string, teacherId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("sessions")
    .select("id, class:classes!inner(teacher_id)")
    .eq("id", sessionId)
    .eq("class.teacher_id", teacherId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export function forbiddenTeacherResponse() {
  return jsonError("No tienes permiso para realizar esta acción.", 403, "FORBIDDEN");
}
