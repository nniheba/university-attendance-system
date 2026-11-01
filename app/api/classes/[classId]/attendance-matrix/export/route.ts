import { getTeacherAttendanceMatrix } from "@/lib/academic/attendance-matrix";
import { attendanceMatrixCsv, matrixCsvFilename } from "@/lib/academic/matrix-csv";
import { jsonError } from "@/lib/http";
import { forbiddenTeacherResponse, requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ classId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { classId } = await context.params;
    const auth = await requireTeacher();
    if (!auth.authenticated) return auth.response;
    if (!(await teacherOwnsClass(classId, auth.user.id))) return forbiddenTeacherResponse();
    const matrix = await getTeacherAttendanceMatrix(classId);
    if (!matrix) return jsonError("Asignatura no encontrada.", 404, "NOT_FOUND");
    return new Response(attendanceMatrixCsv(matrix), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${matrixCsvFilename(matrix.class)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Could not export attendance matrix", error);
    return jsonError("No se pudo exportar la matriz.", 500, "SERVER_ERROR");
  }
}
