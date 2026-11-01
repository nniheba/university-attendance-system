interface StudentAccountResetContext {
  classId: string;
  enrollmentId: string;
}

interface ResetResponseBody {
  message?: unknown;
}

export async function resetStudentAccount(
  email: string,
  context?: StudentAccountResetContext,
): Promise<void> {
  const response = await fetch("/api/teacher/student-device/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, ...context }),
  });

  let body: ResetResponseBody = {};
  try {
    body = await response.json() as ResetResponseBody;
  } catch {
    // Preserve the safe fallback when an upstream failure has no JSON body.
  }

  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "No se pudo restablecer la cuenta del estudiante.",
    );
  }
}
