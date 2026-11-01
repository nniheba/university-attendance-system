import { notFound, redirect } from "next/navigation";
import { TeacherAttendanceMatrix } from "@/components/teacher-attendance-matrix";
import { getTeacherAttendanceMatrix } from "@/lib/academic/attendance-matrix";
import { requireTeacher, teacherOwnsClass } from "@/lib/security/teacher-auth";
import { getOrCreateTeacherProfile } from "@/lib/security/teacher-profile";

export const dynamic = "force-dynamic";

export default async function TeacherAttendanceMatrixPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const auth = await requireTeacher();
  if (!auth.authenticated) redirect("/login");
  const { classId } = await params;
  if (!(await teacherOwnsClass(classId, auth.user.id))) notFound();
  const [matrix, profile] = await Promise.all([
    getTeacherAttendanceMatrix(classId),
    getOrCreateTeacherProfile(auth.user),
  ]);
  if (!matrix) notFound();
  return (
    <TeacherAttendanceMatrix
      initialMatrix={matrix}
      teacher={{
        email: auth.account.email,
        name: profile.display_name,
        avatarKey: profile.avatar_key,
      }}
    />
  );
}
