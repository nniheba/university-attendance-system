import { jsonError, jsonNoStore, readJsonObject } from "@/lib/http";
import { requireTeacher } from "@/lib/security/teacher-auth";
import { getOrCreateTeacherProfile, updateTeacherProfile } from "@/lib/security/teacher-profile";
import { isTeacherAvatarKey } from "@/lib/teacher-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const profile = await getOrCreateTeacherProfile(auth.user);
    return jsonNoStore({ ok: true, profile });
  } catch (error) {
    console.error("Could not read teacher profile", error);
    return jsonError("No se pudo cargar el perfil.", 500, "SERVER_ERROR");
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request, 2_048);
    const avatarKey = body?.avatarKey;
    if (!isTeacherAvatarKey(avatarKey)) {
      return jsonError(
        "Selecciona un avatar disponible.",
        400,
        "INVALID_PROFILE",
      );
    }
    const profile = await updateTeacherProfile(auth.user, avatarKey);
    return jsonNoStore({ ok: true, profile });
  } catch (error) {
    console.error("Could not update teacher profile", error);
    return jsonError("No se pudo actualizar el perfil.", 500, "SERVER_ERROR");
  }
}
