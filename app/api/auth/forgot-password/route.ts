import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { applicationOrigin } from "@/lib/qr/application-origin";
import { normalizeInstitutionalEmail } from "@/lib/security/institutional-email";
import { createServerAuthClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const GENERIC_MESSAGE = "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.";

function recoveryErrorDiagnostic(error: unknown) {
  if (!error || typeof error !== "object") {
    return { name: "UnknownError", code: "unknown", status: null };
  }
  const record = error as { name?: unknown; code?: unknown; status?: unknown };
  return {
    name: typeof record.name === "string" ? record.name : "UnknownError",
    code: typeof record.code === "string" ? record.code : "unknown",
    status: typeof record.status === "number" ? record.status : null,
  };
}

export async function POST(request: Request) {
  const body = await readJsonObject(request, 2_048);
  const email = normalizeInstitutionalEmail(body?.email);
  if (!email) {
    return jsonError("Indica un correo institucional válido.", 400, "INVALID_INSTITUTIONAL_EMAIL");
  }

  try {
    const origin = applicationOrigin(request.url);
    const supabase = await createServerAuthClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset-password`,
    });
    if (error) {
      console.error("Password recovery provider rejected the request", recoveryErrorDiagnostic(error));
    }
  } catch (error) {
    // Keep the public response indistinguishable to prevent account enumeration.
    // Diagnostics intentionally exclude the submitted email, provider message and tokens.
    console.error("Password recovery request failed", recoveryErrorDiagnostic(error));
  }
  return jsonNoStore({ ok: true, message: GENERIC_MESSAGE });
}
