import { notFound, redirect } from "next/navigation";
import { StudentClassDetailView } from "@/components/student-class-detail";
import { getStudentClassDetail } from "@/lib/academic/student-statistics";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";

export const dynamic = "force-dynamic";

export default async function StudentClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role === "teacher") redirect("/teacher");
  const { classId } = await params;
  const [profile, course] = await Promise.all([
    getStudentProfile(identity.identity.user.id),
    getStudentClassDetail(identity.identity.user.id, identity.identity.account.email, classId),
  ]);
  if (!course) notFound();
  return (
    <StudentClassDetailView
      email={identity.identity.account.email}
      displayName={profile.display_name}
      course={course}
    />
  );
}
