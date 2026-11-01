import { redirect } from "next/navigation";

import { StudentScanner } from "@/components/student-scanner";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";

export const dynamic = "force-dynamic";

export default async function StudentScanPage({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string; intent?: string }>;
}) {
  const { debug, intent } = await searchParams;
  const identity = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!identity.ok) {
    redirect(identity.reason === "non_institutional" ? "/auth/sign-out?reason=institutional" : "/login");
  }
  if (identity.identity.account.role === "teacher") redirect("/teacher");
  const profile = await getStudentProfile(identity.identity.user.id);
  return (
    <StudentScanner
      displayName={profile.display_name}
      email={identity.identity.account.email}
      debug={debug === "1"}
      attendanceIntent={intent === "attendance"}
    />
  );
}
