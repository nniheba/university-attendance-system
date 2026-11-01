import { jsonError, readJsonObject } from "@/lib/http";
import { findActiveEnrollment } from "@/lib/academic/enrollments";
import { createSignedToken, verifySignedToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { deriveDeviceHash, DEVICE_COOKIE_NAME, deviceCookieOptions } from "@/lib/security/device";
import { requireStudent } from "@/lib/security/institutional-auth";
import { ensureTrustedStudentDevice } from "@/lib/security/trusted-device";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request);
    if (!body || typeof body.token !== "string" || body.token.length > 2_048) {
      return jsonError("Código de asistencia inválido.", 400, "INVALID_TOKEN");
    }

    const validation = verifySignedToken(body.token, "qr");
    if (!validation.valid) {
      const expired = validation.reason === "expired";
      return jsonError(
        expired
          ? "Este código de asistencia ya expiró. Escanea nuevamente el QR actual."
          : "Código de asistencia inválido.",
        400,
        expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      );
    }

    const { data: session, error } = await createAdminClient()
      .from("sessions")
      .select("id, class_id, status, class:classes(name, teacher_name)")
      .eq("id", validation.payload.session_id)
      .is("deleted_at", null)
      .single();
    if (error || !session) return jsonError("Código de asistencia inválido.", 404, "INVALID_TOKEN");
    if (session.status !== "open") {
      return jsonError(
        "La asistencia de esta clase ya fue cerrada.",
        409,
        "SESSION_CLOSED",
      );
    }

    const enrollment = await findActiveEnrollment(session.class_id, auth.user.id, auth.account.email);
    if (!enrollment) {
      return jsonError("No estás matriculado en esta asignatura.", 403, "STUDENT_NOT_ENROLLED");
    }

    const trustedDevice = await ensureTrustedStudentDevice(request, auth.user.id);
    if (!trustedDevice.trusted) {
      const response = jsonError(
        trustedDevice.code === "DEVICE_BOUND_TO_OTHER_ACCOUNT"
          ? "Este dispositivo ya está vinculado a otra cuenta."
          : "Esta cuenta está vinculada a otro dispositivo.",
        409,
        trustedDevice.code,
      );
      if (trustedDevice.cookieValue) response.cookies.set(DEVICE_COOKIE_NAME, trustedDevice.cookieValue, deviceCookieOptions(request.url));
      return response;
    }

    // The six-second QR proves a timely scan. This short-lived signed grant
    // gives a human enough time to approve geolocation and enter their name.
    const deviceHash = deriveDeviceHash(trustedDevice.deviceId, session.id);
    const registrationToken = createSignedToken(session.id, "registration", Date.now(), deviceHash);
    const response = NextResponse.json({
      ok: true,
      registrationToken,
      class: session.class,
    }, { headers: { "Cache-Control": "no-store" } });
    if (trustedDevice.cookieValue) response.cookies.set(DEVICE_COOKIE_NAME, trustedDevice.cookieValue, deviceCookieOptions(request.url));
    return response;
  } catch {
    return jsonError("No se pudo verificar el código.", 500, "SERVER_ERROR");
  }
}
