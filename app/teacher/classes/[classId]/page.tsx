import { redirect } from "next/navigation";
import { TeacherClassDetail } from "@/components/teacher-class-detail";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";

export const dynamic = "force-dynamic";

export default async function TeacherClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) redirect("/login");
  if (identity.identity.account.role !== "teacher") redirect("/student");
  const [{ classId }, profile] = await Promise.all([
    params,
    getOrCreateTeacherProfile(identity.identity.user),
  ]);
  return <TeacherClassDetail classId={classId} teacher={{ email: identity.identity.account.email, name: profile.display_name, avatarKey: profile.avatar_key }} />;
}
