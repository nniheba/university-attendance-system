import { redirect } from "next/navigation";
import { StudentProfileForm } from "@/components/student-profile-form";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";

export const dynamic = "force-dynamic";

export default async function StudentProfilePage() {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role === "teacher") redirect("/teacher/profile");
  const profile = await getStudentProfile(identity.identity.user.id);
  return <StudentProfileForm email={identity.identity.account.email} initialProfile={profile} />;
}
