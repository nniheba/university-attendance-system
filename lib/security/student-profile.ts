import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import type { StudentProfile } from "@/lib/student-profile";

export async function getStudentProfile(userId: string): Promise<StudentProfile> {
  const { data, error } = await createAdminClient()
    .from("student_profiles")
    .select("user_id, display_name, created_at, updated_at")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw error ?? new Error("STUDENT_PROFILE_NOT_FOUND");
  return data as StudentProfile;
}
