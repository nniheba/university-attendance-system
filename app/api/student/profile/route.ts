import { jsonError, jsonNoStore } from "@/lib/http";
import { requireStudent } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const profile = await getStudentProfile(auth.user.id);
    return jsonNoStore({ ok: true, profile });
  } catch {
    return jsonError("No se pudo cargar el perfil.", 500, "SERVER_ERROR");
  }
}

export function PATCH() {
  const response = jsonError(
    "El nombre institucional se obtiene del correo y no puede modificarse.",
    405,
    "IMMUTABLE_PROFILE",
  );
  response.headers.set("Allow", "GET");
  return response;
}
