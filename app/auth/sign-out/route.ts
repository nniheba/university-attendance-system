import { NextRequest, NextResponse } from "next/server";
import { createServerAuthClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createServerAuthClient();
  await supabase.auth.signOut();
  const destination = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("reason") === "institutional") {
    destination.searchParams.set("access", "institutional");
  }
  if (request.nextUrl.searchParams.get("reason") === "teacher") {
    destination.searchParams.set("access", "teacher");
  }
  return NextResponse.redirect(destination);
}
