import { redirect } from "next/navigation";
import { StudentDashboard } from "@/components/student-dashboard";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";
import { getStudentAcademicSummary } from "@/lib/academic/student-statistics";

export const dynamic = "force-dynamic";

export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<{ ready?: string }>;
}) {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role === "teacher") redirect("/teacher");
  const [profile, query, academicSummary] = await Promise.all([
    getStudentProfile(identity.identity.user.id),
    searchParams,
    getStudentAcademicSummary(identity.identity.user.id, identity.identity.account.email),
  ]);
  return (
    <StudentDashboard
      email={identity.identity.account.email}
      displayName={profile.display_name}
      accountReady={query.ready === "1"}
      academicSummary={academicSummary}
    />
  );
}
