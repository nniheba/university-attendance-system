import { ResetPasswordForm } from "@/components/reset-password-form";
import { cookies } from "next/headers";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const cookieStore = await cookies();
  return (
    <ResetPasswordForm
      code={typeof code === "string" ? code : null}
      serverRecovery={cookieStore.get("password_recovery_v1")?.value === "1"}
    />
  );
}
