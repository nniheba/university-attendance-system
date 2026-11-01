import { NextResponse } from "next/server";

import { findStudentEnrollment } from "@/lib/academic/enrollments";
import { networkLocation } from "@/lib/geolocation/network";
import { evaluateOptionalLocation } from "@/lib/geolocation/evidence";
import { jsonError, readJsonObject } from "@/lib/http";
import {
  attendanceConflict,
  ATTENDANCE_CONFLICT_MESSAGES,
} from "@/lib/security/database-errors";
import {
  deriveDeviceHash,
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
} from "@/lib/security/device";
import { requireStudent } from "@/lib/security/institutional-auth";
import { getStudentProfile } from "@/lib/security/student-profile";
import { verifyAttendanceQrToken } from "@/lib/security/attendance-qr-token";
import { verifySignedToken } from "@/lib/security/token";
import { ensureTrustedStudentDevice } from "@/lib/security/trusted-device";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ClassSummary {
  id: string;
  name: string;
  teacher_name: string;
  status: "active" | "archived";
}

interface SessionSummary {
  id: string;
  class_id: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  allowed_radius_m: number | null;
  allow_self_enrollment: boolean;
  class: ClassSummary | ClassSummary[] | null;
}

function setDeviceCookie(response: NextResponse, value: string | null, requestUrl: string) {
  if (value) response.cookies.set(DEVICE_COOKIE_NAME, value, deviceCookieOptions(requestUrl));
  return response;
}

interface ExistingAttendance {
  id: string;
  full_name: string;
  registered_at: string;
}

function classSummary(value: ClassSummary | ClassSummary[] | null): ClassSummary | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item?.id && item.name ? item : null;
}

function attendanceResponse(
  status: "registered" | "already_registered",
  attendance: ExistingAttendance,
  sessionId: string,
  course: ClassSummary,
  cookie: string | null,
  requestUrl: string,
  enrolled: boolean,
) {
  const response = NextResponse.json(
    { ok: true, status, enrolled, session: { id: sessionId }, attendance, class: course },
    { status: status === "registered" ? 201 : 200, headers: { "Cache-Control": "no-store" } },
  );
  if (cookie) {
    response.cookies.set(DEVICE_COOKIE_NAME, cookie, deviceCookieOptions(requestUrl));
  }
  return response;
}

export async function POST(request: Request) {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;

    const body = await readJsonObject(request, 2_048);
    if (!body || typeof body.token !== "string" || body.token.length > 2_048) {
      return jsonError("Código de asistencia inválido.", 400, "INVALID_TOKEN");
    }

    const validation = body.token.startsWith("q2.")
      ? verifyAttendanceQrToken(body.token)
      : verifySignedToken(body.token, "qr");
    if (!validation.valid) {
      const expired = validation.reason === "expired";
      return jsonError(
        expired
          ? "El código cambió. Enfoca el nuevo código."
          : "Código de asistencia inválido.",
        400,
        expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
      );
    }

    const supabase = createAdminClient();
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("id, class_id, status, latitude, longitude, allowed_radius_m, allow_self_enrollment, class:classes(id, name, teacher_name, status)")
      .eq("id", validation.payload.session_id)
      .is("deleted_at", null)
      .single();
    if (sessionError || !session || session.id !== validation.payload.session_id) {
      return jsonError("Código de clase no válido.", 404, "INVALID_TOKEN");
    }
    if (session.status !== "open") {
      return jsonError(
        "La asistencia de esta clase ya está cerrada.",
        409,
        "SESSION_CLOSED",
      );
    }

    const trustedSession = session as SessionSummary;
    const course = classSummary(trustedSession.class);
    if (!course || trustedSession.class_id !== course.id) {
      return jsonError("No pudimos identificar la clase.", 404, "CLASS_NOT_FOUND");
    }
    const enrollment = await findStudentEnrollment(course.id, auth.user.id, auth.account.email);
    if (enrollment?.status === "inactive") {
      return jsonError("Tu matrícula está inactiva. Pide al docente que la reactive.", 403, "ENROLLMENT_INACTIVE");
    }
    if (!enrollment && !trustedSession.allow_self_enrollment) {
      return jsonError("No estás matriculado en esta asignatura.", 403, "STUDENT_NOT_ENROLLED");
    }

    const trustedDevice = await ensureTrustedStudentDevice(request, auth.user.id);
    if (!trustedDevice.trusted) {
      const message = trustedDevice.code === "DEVICE_BOUND_TO_OTHER_ACCOUNT"
        ? "Este dispositivo ya está vinculado a otra cuenta."
        : "Esta cuenta está vinculada a otro dispositivo.";
      return setDeviceCookie(
        jsonError(message, 409, trustedDevice.code),
        trustedDevice.cookieValue,
        request.url,
      );
    }
    const { data: existingStudent, error: existingStudentError } = await supabase
      .from("attendance")
      .select("id, full_name, registered_at")
      .eq("session_id", session.id)
      .eq("student_user_id", auth.user.id)
      .is("voided_at", null)
      .maybeSingle();
    if (existingStudentError) throw existingStudentError;
    if (existingStudent) {
      return attendanceResponse(
        "already_registered",
        existingStudent as ExistingAttendance,
        session.id,
        course,
        trustedDevice.cookieValue,
        request.url,
        false,
      );
    }

    const deviceHash = deriveDeviceHash(trustedDevice.deviceId, session.id);

    const { data: existingDevice, error: existingDeviceError } = await supabase
      .from("attendance")
      .select("id")
      .eq("session_id", session.id)
      .eq("device_hash", deviceHash)
      .is("voided_at", null)
      .maybeSingle();
    if (existingDeviceError) throw existingDeviceError;
    if (existingDevice) {
      return setDeviceCookie(
        jsonError(
          ATTENDANCE_CONFLICT_MESSAGES.DEVICE_ALREADY_USED,
          409,
          "DEVICE_ALREADY_USED",
        ),
        trustedDevice.cookieValue,
        request.url,
      );
    }

    let enrolled = false;
    if (!enrollment) {
      const { data, error: enrollmentError } = await supabase.rpc(
        "self_enroll_student_for_session",
        {
          p_session_id: session.id,
          p_student_user_id: auth.user.id,
          p_student_email: auth.account.email,
        },
      );
      if (enrollmentError) {
        const message = enrollmentError.message;
        if (message === "ENROLLMENT_INACTIVE") {
          return setDeviceCookie(jsonError("Tu matrícula está inactiva. Pide al docente que la reactive.", 403, message), trustedDevice.cookieValue, request.url);
        }
        if (message === "SESSION_CLOSED") {
          return setDeviceCookie(jsonError("La asistencia de esta clase ya está cerrada.", 409, message), trustedDevice.cookieValue, request.url);
        }
        if (message === "SELF_ENROLLMENT_DISABLED") {
          return setDeviceCookie(jsonError("No estás matriculado en esta asignatura.", 403, "STUDENT_NOT_ENROLLED"), trustedDevice.cookieValue, request.url);
        }
        if (message === "CLASS_ARCHIVED") {
          return setDeviceCookie(jsonError("La asignatura ya no admite nuevas matrículas.", 409, message), trustedDevice.cookieValue, request.url);
        }
        if (message === "INVALID_STUDENT_IDENTITY") {
          return setDeviceCookie(jsonError("La identidad institucional no coincide con la matrícula.", 403, message), trustedDevice.cookieValue, request.url);
        }
        throw enrollmentError;
      }
      enrolled = data === true;
    }

    const profile = await getStudentProfile(auth.user.id);
    const network = networkLocation(request.headers);
    const location = evaluateOptionalLocation(body.location, trustedSession);
    const { data: attendanceId, error: insertError } = await supabase.rpc(
      "register_attendance_if_open",
      {
        p_session_id: session.id,
        p_student_user_id: auth.user.id,
        p_device_hash: deviceHash,
        p_location_accuracy: location.accuracy,
        p_distance_from_center_m: location.distanceFromCenterM,
        p_gps_status: location.status,
        p_network_city: network.city,
        p_network_region: network.region,
        p_network_country: network.country,
        p_network_country_code: network.countryCode,
      },
    );

    if (insertError) {
      const conflict = attendanceConflict(insertError);
      if (conflict === "DUPLICATE_ATTENDANCE") {
        const { data: racedAttendance, error: racedError } = await supabase
          .from("attendance")
          .select("id, full_name, registered_at")
          .eq("session_id", session.id)
          .eq("student_user_id", auth.user.id)
          .is("voided_at", null)
          .single();
        if (racedError || !racedAttendance) throw racedError ?? insertError;
        return attendanceResponse(
          "already_registered",
          racedAttendance as ExistingAttendance,
          session.id,
          course,
          trustedDevice.cookieValue,
          request.url,
          enrolled,
        );
      }
      if (conflict) {
        return setDeviceCookie(
          jsonError(ATTENDANCE_CONFLICT_MESSAGES[conflict], conflict === "STUDENT_NOT_ENROLLED" ? 403 : 409, conflict),
          trustedDevice.cookieValue,
          request.url,
        );
      }
      throw insertError;
    }

    return attendanceResponse(
      "registered",
      {
        id: String(attendanceId),
        full_name: profile.display_name,
        registered_at: new Date().toISOString(),
      },
      session.id,
      course,
      trustedDevice.cookieValue,
      request.url,
      enrolled,
    );
  } catch {
    // Never log QR tokens, cookies, provider errors or student network metadata.
    return jsonError("No se pudo registrar la asistencia.", 500, "SERVER_ERROR");
  }
}
