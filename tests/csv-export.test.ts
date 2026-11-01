import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({ authenticated: false, ownsSession: false }));
const admin = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/security/teacher-auth", () => ({
  requireTeacher: async () => security.authenticated
    ? { authenticated: true, user: { id: "teacher-a" } }
    : { authenticated: false, response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) },
  teacherOwnsSession: async () => security.ownsSession,
  forbiddenTeacherResponse: () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => admin }));

import { GET } from "@/app/api/sessions/[id]/export/route";

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const context = { params: Promise.resolve({ id: sessionId }) };

function installSuccessfulQueries(subject = "=SUM(1,1)") {
  const sessionQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: {
        id: sessionId,
        session_name: "Docker y contenedores",
        opened_at: "2026-09-21T08:00:00.000Z",
        class: { name: subject, group_name: "IYA2021", academic_year: "2026-2027" },
      },
      error: null,
    })),
  };
  sessionQuery.select.mockReturnValue(sessionQuery);
  sessionQuery.eq.mockReturnValue(sessionQuery);

  const attendanceQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(async () => ({
      data: [
        {
          full_name: "+Ana, \"García\"",
          student_email_snapshot: "ana@students.example.edu",
          registered_at: "2026-09-21T10:01:02.000Z",
          source: "qr",
          review_status: "normal",
          gps_status: "verified",
        },
        {
          full_name: "Beatriz López",
          student_email_snapshot: "beatriz@students.example.edu",
          registered_at: "2026-09-21T10:02:03.000Z",
          source: "manual",
          review_status: "suspicious",
          gps_status: "not_shared",
        },
      ],
      error: null,
    })),
  };
  attendanceQuery.select.mockReturnValue(attendanceQuery);
  attendanceQuery.eq.mockReturnValue(attendanceQuery);
  attendanceQuery.is.mockReturnValue(attendanceQuery);

  admin.from.mockImplementation((table: string) => table === "sessions" ? sessionQuery : attendanceQuery);
}

beforeEach(() => {
  security.authenticated = false;
  security.ownsSession = false;
  vi.clearAllMocks();
});

describe("teacher CSV export", () => {
  it("requires authentication and session ownership", async () => {
    expect((await GET(new Request("https://test.invalid/export"), context)).status).toBe(401);
    security.authenticated = true;
    expect((await GET(new Request("https://test.invalid/export"), context)).status).toBe(403);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("adds the subject to every row and preserves safe spreadsheet formatting", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    installSuccessfulQueries();

    const response = await GET(new Request("https://test.invalid/export"), context);
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const csv = await response.text();
    const lines = csv.split("\r\n");

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(lines[0]).toBe("\"Nombre completo\",\"Correo institucional\",\"Asignatura\",\"Grupo\",\"Periodo académico\",\"Sesión\",\"Fecha de sesión\",\"Hora de sesión\",\"Hora de registro\",\"Origen\",\"Estado\",\"Ubicación\"");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("\"'+Ana, \"\"García\"\"\"");
    expect(lines[1]).toContain("\"'=SUM(1,1)\"");
    expect(lines[2]).toContain("\"'=SUM(1,1)\"");
    expect(lines[1]).toContain("\"ana@students.example.edu\"");
    expect(lines[1]).toContain("\"IYA2021\",\"2026-2027\",\"Docker y contenedores\"");
    expect(lines[1]).toContain("\"QR\",\"Normal\",\"Compatible\"");
    expect(lines[2]).toContain("\"Manual\",\"Sospechosa\",\"No compartida\"");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("sum-1-1-docker-y-contenedores-2026-09-21.csv");
  });

  it.each(["+Asignatura", "-Asignatura", "@Asignatura"]) (
    "neutralizes a formula-like subject beginning with %s",
    async (subject) => {
      security.authenticated = true;
      security.ownsSession = true;
      installSuccessfulQueries(subject);
      const csv = await (await GET(new Request("https://test.invalid/export"), context)).text();
      expect(csv).toContain(`"'${subject}"`);
    },
  );

  it("quotes a subject containing a comma", async () => {
    security.authenticated = true;
    security.ownsSession = true;
    installSuccessfulQueries("Informática, avanzada");
    const csv = await (await GET(new Request("https://test.invalid/export"), context)).text();
    expect(csv).toContain("\"Informática, avanzada\"");
  });
});
