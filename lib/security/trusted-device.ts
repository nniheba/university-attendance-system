import "server-only";

import { NextRequest } from "next/server";

import {
  createDeviceCookie,
  deriveTrustedDeviceHash,
  DEVICE_COOKIE_NAME,
  verifyDeviceCookie,
} from "@/lib/security/device";
import { createAdminClient } from "@/lib/supabase/server";

export type TrustedDeviceCode =
  | "TRUSTED_DEVICE"
  | "ACCOUNT_DEVICE_MISMATCH"
  | "DEVICE_BOUND_TO_OTHER_ACCOUNT";

export interface TrustedDeviceResult {
  trusted: boolean;
  currentDevice: boolean;
  enrolled: boolean;
  code: TrustedDeviceCode;
  deviceId: string;
  cookieValue: string | null;
}

interface TrustedDeviceRow {
  user_id: string;
  device_hash: string;
}

async function readBindings(userId: string, deviceHash: string) {
  const supabase = createAdminClient();
  const [{ data: account, error: accountError }, { data: device, error: deviceError }] =
    await Promise.all([
      supabase
        .from("student_trusted_devices")
        .select("user_id, device_hash")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("student_trusted_devices")
        .select("user_id, device_hash")
        .eq("device_hash", deviceHash)
        .maybeSingle(),
    ]);
  if (accountError) throw accountError;
  if (deviceError) throw deviceError;
  return {
    account: account as TrustedDeviceRow | null,
    device: device as TrustedDeviceRow | null,
  };
}

export async function ensureTrustedStudentDevice(
  request: Request,
  userId: string,
): Promise<TrustedDeviceResult> {
  const suppliedCookie = new NextRequest(request.url, { headers: request.headers })
    .cookies.get(DEVICE_COOKIE_NAME)?.value;
  const suppliedDeviceId = verifyDeviceCookie(suppliedCookie);
  const generatedCookie = suppliedDeviceId ? null : createDeviceCookie();
  const deviceId = suppliedDeviceId ?? verifyDeviceCookie(generatedCookie ?? undefined);
  if (!deviceId) throw new Error("Could not create a valid device cookie.");

  const cookieValue = generatedCookie;
  const deviceHash = deriveTrustedDeviceHash(deviceId);
  let bindings = await readBindings(userId, deviceHash);

  if (bindings.device && bindings.device.user_id !== userId) {
    return {
      trusted: false,
      currentDevice: false,
      enrolled: false,
      code: "DEVICE_BOUND_TO_OTHER_ACCOUNT",
      deviceId,
      cookieValue,
    };
  }
  if (bindings.account && bindings.account.device_hash !== deviceHash) {
    return {
      trusted: false,
      currentDevice: false,
      enrolled: false,
      code: "ACCOUNT_DEVICE_MISMATCH",
      deviceId,
      cookieValue,
    };
  }
  if (bindings.account?.device_hash === deviceHash) {
    return {
      trusted: true,
      currentDevice: true,
      enrolled: false,
      code: "TRUSTED_DEVICE",
      deviceId,
      cookieValue,
    };
  }

  const { error } = await createAdminClient().from("student_trusted_devices").insert({
    user_id: userId,
    device_hash: deviceHash,
  });
  if (error) {
    // Concurrent first requests are resolved from the database rather than by
    // replacing either side of the one-account/one-device relationship.
    if (error.code !== "23505") throw error;
    bindings = await readBindings(userId, deviceHash);
    if (bindings.device?.user_id !== userId) {
      return {
        trusted: false,
        currentDevice: false,
        enrolled: false,
        code: "DEVICE_BOUND_TO_OTHER_ACCOUNT",
        deviceId,
        cookieValue,
      };
    }
    if (bindings.account?.device_hash !== deviceHash) {
      return {
        trusted: false,
        currentDevice: false,
        enrolled: false,
        code: "ACCOUNT_DEVICE_MISMATCH",
        deviceId,
        cookieValue,
      };
    }
  }

  return {
    trusted: true,
    currentDevice: true,
    enrolled: true,
    code: "TRUSTED_DEVICE",
    deviceId,
    cookieValue,
  };
}
