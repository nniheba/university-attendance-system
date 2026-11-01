import "server-only";

import { deriveInstitutionalDisplayName, institutionalEmailAudience, normalizeInstitutionalEmail } from "@/lib/security/institutional-email";
import { createAdminClient } from "@/lib/supabase/server";
import type { EnrollmentRecord, EnrollmentView } from "@/lib/types";

const ENROLLMENT_COLUMNS = "id, class_id, student_email, student_user_id, status, enrolled_at, unenrolled_at, created_by, created_at, updated_at";

export function normalizeStudentEnrollmentEmail(value: unknown): string | null {
  const email = normalizeInstitutionalEmail(value);
  return email && institutionalEmailAudience(email) === "student" ? email : null;
}

export async function linkedStudentUserId(email: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("institutional_accounts")
    .select("user_id")
    .eq("email", email)
    .eq("role", "student")
    .maybeSingle();
  if (error) throw error;
  return data?.user_id ?? null;
}

export async function linkStudentEnrollments(userId: string, emailValue: unknown): Promise<number> {
  const email = normalizeStudentEnrollmentEmail(emailValue);
  if (!email) throw new Error("INVALID_STUDENT_EMAIL");
  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("institutional_accounts")
    .select("user_id, email, role")
    .eq("user_id", userId)
    .eq("email", email)
    .eq("role", "student")
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) throw new Error("STUDENT_IDENTITY_REQUIRED");

  const { data, error } = await admin
    .from("class_enrollments")
    .update({ student_user_id: userId })
    .eq("student_email", email)
    .is("student_user_id", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function findActiveEnrollment(
  classId: string,
  userId: string,
  emailValue: unknown,
): Promise<EnrollmentRecord | null> {
  const enrollment = await findStudentEnrollment(classId, userId, emailValue);
  return enrollment?.status === "active" ? enrollment : null;
}

export async function findStudentEnrollment(
  classId: string,
  userId: string,
  emailValue: unknown,
): Promise<EnrollmentRecord | null> {
  const email = normalizeStudentEnrollmentEmail(emailValue);
  if (!email) return null;
  const admin = createAdminClient();
  const { data: linked, error: linkedError } = await admin
    .from("class_enrollments")
    .select(ENROLLMENT_COLUMNS)
    .eq("class_id", classId)
    .eq("student_user_id", userId)
    .maybeSingle();
  if (linkedError) throw linkedError;
  if (linked) return linked.student_email === email ? linked as EnrollmentRecord : null;

  const { data: byEmail, error: emailError } = await admin
    .from("class_enrollments")
    .select(ENROLLMENT_COLUMNS)
    .eq("class_id", classId)
    .eq("student_email", email)
    .maybeSingle();
  if (emailError) throw emailError;
  if (!byEmail || (byEmail.student_user_id && byEmail.student_user_id !== userId)) return null;
  if (!byEmail.student_user_id && byEmail.status === "active") {
    const { data: updated, error: updateError } = await admin
      .from("class_enrollments")
      .update({ student_user_id: userId })
      .eq("id", byEmail.id)
      .is("student_user_id", null)
      .select(ENROLLMENT_COLUMNS)
      .single();
    if (updateError) throw updateError;
    return updated as EnrollmentRecord;
  }
  return byEmail as EnrollmentRecord;
}

export async function enrollmentView(record: EnrollmentRecord): Promise<EnrollmentView> {
  const [view] = await enrollmentViews([record]);
  return view;
}

export async function enrollmentViews(records: readonly EnrollmentRecord[]): Promise<EnrollmentView[]> {
  const userIds = [...new Set(records.flatMap((record) => record.student_user_id ? [record.student_user_id] : []))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data, error } = await createAdminClient()
      .from("student_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    if (error) throw error;
    for (const profile of data ?? []) names.set(profile.user_id, profile.display_name);
  }

  return records.map((record) => ({
    enrollmentId: record.id,
    email: record.student_email,
    displayName: (record.student_user_id && names.get(record.student_user_id))
      || deriveInstitutionalDisplayName(record.student_email)
      || record.student_email,
    registered: Boolean(record.student_user_id),
    status: record.status,
    enrolledAt: record.enrolled_at,
  }));
}

export async function getStudentActiveClasses(userId: string, emailValue: unknown) {
  const email = normalizeStudentEnrollmentEmail(emailValue);
  if (!email) return [];
  await linkStudentEnrollments(userId, email);
  const { data, error } = await createAdminClient()
    .from("class_enrollments")
    .select("enrolled_at, class:classes!inner(id, name, group_name, academic_year, status, teacher_name, color_key)")
    .eq("student_user_id", userId)
    .eq("status", "active")
    .eq("class.status", "active")
    .order("enrolled_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
