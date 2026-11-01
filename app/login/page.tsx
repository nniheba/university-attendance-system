import { LoginForm } from "@/components/login-form";
import { getCurrentInstitutionalIdentity } from "@/lib/security/institutional-auth";
import { safeAttendanceIntent } from "@/lib/security/attendance-intent";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ access?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const identityPromise = getCurrentInstitutionalIdentity({ bootstrap: true });
  const query = await searchParams;
  const attendanceIntent = safeAttendanceIntent(query.next);
  let identity: Awaited<ReturnType<typeof getCurrentInstitutionalIdentity>>;
  try {
    identity = await identityPromise;
  } catch {
    return <LoginForm bootstrapFailure />;
  }
  if (identity.ok) {
    redirect(identity.identity.account.role === "teacher" ? "/teacher" : attendanceIntent ?? "/student");
  }
  if (identity.reason === "non_institutional") {
    redirect("/auth/sign-out?reason=institutional");
  }
  if (identity.reason === "teacher_not_authorized") {
    redirect("/auth/sign-out?reason=teacher");
  }

  return (
    <LoginForm
      institutionalOnly={query.access === "institutional"}
      teacherAccessDenied={query.access === "teacher"}
      attendanceIntent={attendanceIntent}
    />
  );
}
