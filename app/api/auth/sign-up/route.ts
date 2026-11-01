import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import {
  bootstrapInstitutionalAccount,
  isTeacherAccessNotAuthorized,
} from "@/lib/security/institutional-auth";
import { normalizeInstitutionalEmail } from "@/lib/security/institutional-email";
import { isValidInstitutionalPassword } from "@/lib/security/institutional-password";
import { createServerAuthClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request, 2_048);
    const email = normalizeInstitutionalEmail(body?.email);
    const password = body?.password;
    if (!email) {
      return jsonError(
        "Usa un correo institucional válido.",
        400,
        "INVALID_INSTITUTIONAL_EMAIL",
      );
    }
    if (!isValidInstitutionalPassword(password)) {
      return jsonError(
        "La contraseña debe tener al menos 8 caracteres.",
        400,
        "INVALID_PASSWORD",
      );
    }

    const supabase = await createServerAuthClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error || !data.user) {
      return jsonError(
        "No pudimos crear la cuenta. Si ya existe, inicia sesión.",
        400,
        "SIGN_UP_FAILED",
      );
    }
    if (!data.session) {
      await supabase.auth.signOut();
      return jsonError(
        "La cuenta no pudo iniciar sesión automáticamente. Contacta con soporte.",
        409,
        "EMAIL_CONFIRMATION_REQUIRED",
      );
    }

    try {
      const identity = await bootstrapInstitutionalAccount(data.user);
      return jsonNoStore({
        ok: true,
        role: identity.account.role,
        destination: identity.account.role === "teacher" ? "/teacher" : "/student?ready=1",
      });
    } catch (bootstrapError) {
      await supabase.auth.signOut();
      if (isTeacherAccessNotAuthorized(bootstrapError)) {
        return jsonError(
          "Tu cuenta institucional no tiene acceso docente autorizado.",
          403,
          "TEACHER_ACCESS_NOT_AUTHORIZED",
        );
      }
      return jsonError(
        "La cuenta se creó, pero no pudimos preparar el acceso. Inténtalo más tarde.",
        500,
        "ACCOUNT_BOOTSTRAP_FAILED",
      );
    }
  } catch {
    return jsonError(
      "No pudimos crear la cuenta. Comprueba tu conexión e inténtalo de nuevo.",
      500,
      "SIGN_UP_FAILED",
    );
  }
}
