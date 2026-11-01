import { TeacherDashboard } from "@/components/teacher-dashboard";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TeacherPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string }>;
}) {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role !== "teacher") redirect("/student");
  const profile = await getOrCreateTeacherProfile(identity.identity.user);
  const query = await searchParams;
  return (
    <TeacherDashboard
      teacher={{
        email: identity.identity.account.email,
        name: profile.display_name,
        avatarKey: profile.avatar_key,
      }}
      initialClassId={typeof query.classId === "string" ? query.classId : null}
    />
  );
}
