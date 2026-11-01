import { jsonError, jsonNoStore } from "@/lib/http";
import { applicationOrigin } from "@/lib/qr/application-origin";
import { attendanceQrUrl } from "@/lib/qr/attendance-value";
import { createAttendanceQrToken } from "@/lib/security/attendance-qr-token";
import { QR_TOKEN_LIFETIME_MS } from "@/lib/qr/constants";
import { createAdminClient } from "@/lib/supabase/server";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsSession } from "@/lib/security/teacher-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsSession(id, auth.user.id))) return forbiddenTeacherResponse();
    const { data: session, error } = await createAdminClient()
      .from("sessions")
      .select("id, status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (error || !session) return jsonError("Sesión no encontrada.", 404, "NOT_FOUND");
    if (session.status !== "open") {
      return jsonError("La asistencia de esta clase ya fue cerrada.", 409, "SESSION_CLOSED");
    }

    const token = createAttendanceQrToken(session.id);
    return jsonNoStore(
      {
        ok: true,
        value: attendanceQrUrl(applicationOrigin(request.url), token),
        expiresInMs: QR_TOKEN_LIFETIME_MS,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Could not create QR token", error);
    return jsonError("No se pudo generar el QR.", 500, "SERVER_ERROR");
  }
}
