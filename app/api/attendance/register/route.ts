import { verifyLocation } from "@/lib/geolocation/distance";
import { findActiveEnrollment } from "@/lib/academic/enrollments";
import { networkLocation } from "@/lib/geolocation/network";
import { jsonError, jsonNoStore, parseFiniteNumber, readJsonObject } from "@/lib/http";
import { attendanceConflict, ATTENDANCE_CONFLICT_MESSAGES, type AttendanceConflict } from "@/lib/security/database-errors";
import { deriveDeviceHash } from "@/lib/security/device";
import { requireStudent } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";
import { verifySignedToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureTrustedStudentDevice } from "@/lib/security/trusted-device";

export const runtime = "nodejs";
const conflictResponse = (code: AttendanceConflict) => jsonError(
  ATTENDANCE_CONFLICT_MESSAGES[code],
  code === "STUDENT_NOT_ENROLLED" ? 403 : 409,
  code,
);

export async function POST(request: Request) {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const body = await readJsonObject(request);
    if (!body || typeof body.token !== "string" || body.token.length > 2_048) {
      return jsonError("Código de asistencia inválido.", 400, "INVALID_TOKEN");
    }
    const token = verifySignedToken(body.token, "registration");
    if (!token.valid) {
      return jsonError(
        token.reason === "expired" ? "El plazo para registrarte terminó. Escanea nuevamente el QR actual." : "Código de asistencia inválido.",
        400, token.reason === "expired" ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      );
    }
    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase.from("sessions")
      .select("id, class_id, status, latitude, longitude, allowed_radius_m, location_country_code")
      .eq("id", token.payload.session_id).is("deleted_at", null).single();
    if (sessionError || !session) return jsonError("Sesión no encontrada.", 404, "INVALID_TOKEN");
    if (session.status !== "open") return conflictResponse("SESSION_CLOSED");

    const enrollment = await findActiveEnrollment(session.class_id, auth.user.id, auth.account.email);
    if (!enrollment) return conflictResponse("STUDENT_NOT_ENROLLED");

    const trustedDevice = await ensureTrustedStudentDevice(request, auth.user.id);
    if (!trustedDevice.trusted) {
      return jsonError(
        trustedDevice.code === "DEVICE_BOUND_TO_OTHER_ACCOUNT"
          ? "Este dispositivo ya está vinculado a otra cuenta."
          : "Esta cuenta está vinculada a otro dispositivo.",
        409,
        trustedDevice.code,
      );
    }

    const latitude = parseFiniteNumber(body.latitude);
    const longitude = parseFiniteNumber(body.longitude);
    const accuracy = parseFiniteNumber(body.accuracy);
    if (latitude === null || longitude === null || accuracy === null) {
      return jsonError("La ubicación recibida no es válida.", 400, "INVALID_LOCATION");
    }
    const location = verifyLocation(
      { latitude, longitude }, { latitude: session.latitude, longitude: session.longitude },
      accuracy, session.allowed_radius_m,
    );
    if (!location.allowed) {
      const insufficient = location.reason === "insufficient_accuracy";
      return jsonError(
        insufficient ? "La precisión de tu ubicación no permite confirmar que estás dentro de la zona."
          : location.reason === "outside" ? "Estás fuera de la zona permitida para esta clase." : "La ubicación recibida no es válida.",
        422, insufficient ? "INSUFFICIENT_ACCURACY" : location.reason === "outside" ? "OUTSIDE_GEOFENCE" : "INVALID_LOCATION",
      );
    }
    const deviceId = trustedDevice.deviceId;
    const deviceHash = deriveDeviceHash(deviceId, session.id);
    if (token.payload.device_hash !== deviceHash) {
      return jsonError("Este registro pertenece a otro navegador. Escanea nuevamente el QR.", 400, "INVALID_DEVICE_COOKIE");
    }
    const { data: existingDevice, error: deviceError } = await supabase.from("attendance")
      .select("id").eq("session_id", session.id).eq("device_hash", deviceHash).maybeSingle();
    if (deviceError) throw deviceError;
    if (existingDevice) return conflictResponse("DEVICE_ALREADY_USED");

    const { data: existingStudent, error: studentError } = await supabase.from("attendance")
      .select("id").eq("session_id", session.id).eq("student_user_id", auth.user.id).maybeSingle();
    if (studentError) throw studentError;
    if (existingStudent) return conflictResponse("DUPLICATE_ATTENDANCE");

    const profile = await getStudentProfile(auth.user.id);

    const network = networkLocation(request.headers);
    const { data: attendanceId, error: insertError } = await supabase.rpc("register_attendance_if_open", {
      p_session_id: session.id,
      p_student_user_id: auth.user.id,
      p_location_accuracy: accuracy,
      p_distance_from_center_m: location.distanceM,
      p_device_hash: deviceHash,
      p_gps_status: "verified",
      p_network_city: network.city,
      p_network_region: network.region,
      p_network_country: network.country,
      p_network_country_code: network.countryCode,
    });
    if (insertError) {
      const conflict = attendanceConflict(insertError);
      if (conflict) return conflictResponse(conflict);
      throw insertError;
    }
    return jsonNoStore({ ok: true, attendance: { id: attendanceId, full_name: profile.display_name, registered_at: new Date().toISOString() } }, { status: 201 });
  } catch {
    // Do not log request bodies, cookies, coordinates or provider errors.
    return jsonError("No se pudo registrar la asistencia.", 500, "SERVER_ERROR");
  }
}
