import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import {
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
} from "@/lib/security/device";
import { requireStudent } from "@/lib/security/institutional-auth";
import { ensureTrustedStudentDevice } from "@/lib/security/trusted-device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const device = await ensureTrustedStudentDevice(request, auth.user.id);
    const response = NextResponse.json(
      {
        trusted: device.trusted,
        currentDevice: device.currentDevice,
        enrolled: device.enrolled,
        code: device.code,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (device.cookieValue) {
      response.cookies.set(
        DEVICE_COOKIE_NAME,
        device.cookieValue,
        deviceCookieOptions(request.url),
      );
    }
    return response;
  } catch {
    return jsonError("No se pudo verificar este dispositivo.", 500, "SERVER_ERROR");
  }
}
