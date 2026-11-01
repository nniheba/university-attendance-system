import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerAuthClient } from "@/lib/supabase/server";
import { isEmailOtpType, safeAuthDestination } from "@/lib/security/auth-confirmation";

function loginRedirect(request: NextRequest, state: "confirmed" | "expired") {
  const destination = new URL("/login", request.url);
  if (state === "confirmed") destination.searchParams.set("confirmed", "1");
  else destination.searchParams.set("confirmation", "expired");
  return NextResponse.redirect(destination);
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = safeAuthDestination(request.nextUrl.searchParams.get("next"));

  if (!tokenHash || !isEmailOtpType(type)) {
    return loginRedirect(request, "expired");
  }

  const supabase = await createServerAuthClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

  if (error) return loginRedirect(request, "expired");
  if (type === "recovery" && data.session) {
    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    response.cookies.set("password_recovery_v1", "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:",
      path: "/reset-password",
      maxAge: 10 * 60,
    });
    return response;
  }
  if (!data.session) return loginRedirect(request, "confirmed");

  return NextResponse.redirect(new URL(next, request.url));
}
