import "server-only";

import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { linkStudentEnrollments } from "@/lib/academic/enrollments";
import { jsonError } from "@/lib/http";
import {
  deriveInstitutionalDisplayName,
  institutionalEmailAudience,
  normalizeInstitutionalEmail,
} from "@/lib/security/institutional-email";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";
import { createAdminClient, createServerAuthClient } from "@/lib/supabase/server";

export type InstitutionalRole = "student" | "teacher";

export interface InstitutionalAccount {
  user_id: string;
  email: string;
  role: InstitutionalRole;
  created_at: string;
  updated_at: string;
}

export interface InstitutionalIdentity {
  user: User;
  account: InstitutionalAccount;
}

export type InstitutionalIdentityResult =
  | { ok: true; identity: InstitutionalIdentity }
  | { ok: false; reason: "unauthenticated" | "non_institutional" | "teacher_not_authorized" | "unbootstrapped" };

export type InstitutionalAuthorization =
  | { authenticated: true; user: User; account: InstitutionalAccount }
  | { authenticated: false; response: Response };

const TEACHER_ACCESS_NOT_AUTHORIZED = "TEACHER_ACCESS_NOT_AUTHORIZED";

export function isTeacherAccessNotAuthorized(error: unknown): boolean {
  return error instanceof Error && error.message === TEACHER_ACCESS_NOT_AUTHORIZED;
}

export function roleForInstitutionalEmail(
  email: string,
  activeTeacherAllowlistEntry: boolean,
): InstitutionalRole | null {
  const audience = institutionalEmailAudience(email);
  if (audience === "student") return "student";
  if (audience === "teacher" && activeTeacherAllowlistEntry) return "teacher";
  return null;
}

async function hasActiveTeacherAccess(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("teacher_allowlist")
    .select("email")
    .eq("email", email)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function bootstrapInstitutionalAccount(user: User): Promise<InstitutionalIdentity> {
  const email = normalizeInstitutionalEmail(user.email);
  const displayName = deriveInstitutionalDisplayName(email);
  const audience = institutionalEmailAudience(email);
  if (!email || !displayName || !audience) throw new Error("INSTITUTIONAL_EMAIL_REQUIRED");

  const admin = createAdminClient();
  const allowlisted = audience === "teacher" && await hasActiveTeacherAccess(admin, email);
  const role = roleForInstitutionalEmail(email, allowlisted);
  if (!role) throw new Error(TEACHER_ACCESS_NOT_AUTHORIZED);
  const { error: accountError } = await admin
    .from("institutional_accounts")
    .upsert(
      { user_id: user.id, email, role, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (accountError) throw accountError;

  if (role === "teacher") {
    await getOrCreateTeacherProfile(user);
  } else {
    const { error: profileError } = await admin
      .from("student_profiles")
      .upsert(
        { user_id: user.id, display_name: displayName },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
    if (profileError) throw profileError;
    await linkStudentEnrollments(user.id, email);
  }

  const { data: account, error: readError } = await admin
    .from("institutional_accounts")
    .select("user_id, email, role, created_at, updated_at")
    .eq("user_id", user.id)
    .single();
  if (readError || !account) throw readError ?? new Error("ACCOUNT_BOOTSTRAP_FAILED");

  return { user, account: account as InstitutionalAccount };
}

const getCurrentInstitutionalIdentityForRequest = cache(async (
  bootstrap: boolean,
): Promise<InstitutionalIdentityResult> => {
  const auth = await createServerAuthClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return { ok: false, reason: "unauthenticated" };
  const email = normalizeInstitutionalEmail(data.user.email);
  const audience = institutionalEmailAudience(email);
  if (!email || !audience) {
    return { ok: false, reason: "non_institutional" };
  }

  const admin = createAdminClient();
  const { data: account, error: accountError } = await admin
    .from("institutional_accounts")
    .select("user_id, email, role, created_at, updated_at")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (accountError) throw accountError;
  if (account && account.email === email) {
    if (audience === "student" && account.role === "student") {
      return { ok: true, identity: { user: data.user, account: account as InstitutionalAccount } };
    }
    if (audience === "teacher") {
      const allowlisted = await hasActiveTeacherAccess(admin, email);
      if (!allowlisted) return { ok: false, reason: "teacher_not_authorized" };
      if (account.role === "teacher") {
        return { ok: true, identity: { user: data.user, account: account as InstitutionalAccount } };
      }
    }
  }
  if (!bootstrap) return { ok: false, reason: "unbootstrapped" };
  try {
    return { ok: true, identity: await bootstrapInstitutionalAccount(data.user) };
  } catch (error) {
    if (isTeacherAccessNotAuthorized(error)) {
      return { ok: false, reason: "teacher_not_authorized" };
    }
    throw error;
  }
});

export function getCurrentInstitutionalIdentity(
  options: { bootstrap?: boolean } = {},
): Promise<InstitutionalIdentityResult> {
  return getCurrentInstitutionalIdentityForRequest(options.bootstrap === true);
}

export async function requireInstitutionalUser(): Promise<InstitutionalAuthorization> {
  const result = await getCurrentInstitutionalIdentity({ bootstrap: true });
  if (!result.ok) {
    const unauthenticated = result.reason === "unauthenticated";
    const teacherNotAuthorized = result.reason === "teacher_not_authorized";
    return {
      authenticated: false,
      response: jsonError(
        unauthenticated
          ? "Inicia sesión con tu correo institucional para continuar."
          : teacherNotAuthorized
            ? "Tu cuenta institucional no tiene acceso docente autorizado."
            : "Esta aplicación requiere un correo institucional válido.",
        unauthenticated ? 401 : 403,
        unauthenticated
          ? "UNAUTHENTICATED"
          : teacherNotAuthorized
            ? "TEACHER_ACCESS_NOT_AUTHORIZED"
            : "INSTITUTIONAL_ACCESS_REQUIRED",
      ),
    };
  }
  return { authenticated: true, ...result.identity };
}

export async function requireTeacher(): Promise<InstitutionalAuthorization> {
  const auth = await requireInstitutionalUser();
  if (!auth.authenticated) return auth;
  if (auth.account.role !== "teacher") {
    return {
      authenticated: false,
      response: jsonError("No tienes permiso para realizar esta acción.", 403, "FORBIDDEN"),
    };
  }
  return auth;
}

export async function requireStudent(): Promise<InstitutionalAuthorization> {
  const auth = await requireInstitutionalUser();
  if (!auth.authenticated) return auth;
  if (auth.account.role !== "student") {
    return {
      authenticated: false,
      response: jsonError("Esta acción está disponible únicamente para estudiantes.", 403, "FORBIDDEN"),
    };
  }
  return auth;
}
