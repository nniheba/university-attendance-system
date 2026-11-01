import { getStudentAcademicSummary } from "@/lib/academic/student-statistics";
import { jsonError, jsonNoStore } from "@/lib/http";
import { requireStudent } from "@/lib/security/institutional-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireStudent();
    if (!auth.authenticated) return auth.response;
    const summary = await getStudentAcademicSummary(auth.user.id, auth.account.email);
    return jsonNoStore({ ok: true, classes: summary.classes, overall: summary.overall });
  } catch (error) {
    console.error("Could not read student classes", error);
    return jsonError("No se pudieron cargar tus asignaturas.", 500, "SERVER_ERROR");
  }
}
