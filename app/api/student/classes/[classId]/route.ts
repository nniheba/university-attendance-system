import { getStudentClassDetail } from "@/lib/academic/student-statistics";
import { jsonError, jsonNoStore } from "@/lib/http";
import { requireStudent } from "@/lib/security/institutional-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const course = await getStudentClassDetail(auth.user.id, auth.account.email, classId);
    if (!course) return jsonError("Asignatura no encontrada.", 404, "NOT_FOUND");
    return jsonNoStore({ ok: true, class: course });
  } catch (error) {
    console.error("Could not read student class detail", error);
    return jsonError("No se pudo cargar la asignatura.", 500, "SERVER_ERROR");
  }
}
