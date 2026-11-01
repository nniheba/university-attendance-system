import { redirect } from "next/navigation";
import { TeacherProfileForm } from "@/components/teacher-profile-form";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";

export const dynamic = "force-dynamic";

export default async function TeacherProfilePage() {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role !== "teacher") redirect("/student/profile");
  const profile = await getOrCreateTeacherProfile(identity.identity.user);

  return (
    <TeacherProfileForm
      email={identity.identity.account.email}
      initialProfile={profile}
    />
  );
}
