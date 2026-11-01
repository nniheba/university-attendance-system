# Campus Attendance — v1.0.0

Aplicación web universitaria para gestionar asignaturas, matrículas y asistencia mediante autenticación institucional, códigos QR temporales, navegador de confianza, Supabase Realtime y una matriz académica auditable.

Este repositorio es un proyecto académico genérico. No está afiliado, patrocinado ni respaldado por ninguna universidad concreta. Los nombres, dominios y recursos visuales incluidos son propios o ejemplos reservados.

## Funcionalidades

- Cuentas separadas para estudiantes y docentes.
- Acceso docente protegido mediante allowlist.
- Asignaturas persistentes con matrículas activas e inactivas.
- Sesiones de asistencia con QR firmado y rotación cada cuatro segundos.
- Escáner interno y compatibilidad con la cámara nativa del teléfono.
- Un navegador de confianza por cuenta estudiantil, restablecible por el docente.
- Evidencia de ubicación opcional sin persistir coordenadas exactas del estudiante.
- Registro manual, notas, revisión, anulación lógica y auditoría.
- Panel docente y modo proyección actualizados mediante Supabase Realtime.
- Matriz de asistencia y exportaciones CSV compatibles con Excel y Google Sheets.
- Recuperación segura de contraseña mediante Supabase Auth.

## Stack

- Next.js 16 con App Router
- React 19 y TypeScript
- Tailwind CSS
- Supabase Auth, PostgreSQL y Realtime
- `@supabase/ssr`
- HMAC-SHA-256 para QR y cookie de dispositivo
- `qrcode`, `qr-scanner` y `@zxing/browser`
- Vitest y PGlite

## Modelo general

```text
Docente
  └── Asignatura
        ├── Matrículas
        │     └── Estudiantes
        └── Sesiones
              └── Asistencias
```

El servidor valida la identidad, el rol, el QR, la sesión y el navegador de confianza antes de registrar una asistencia. El cliente nunca decide por sí solo que una asistencia es válida.

## Dominios de ejemplo

La distribución pública usa exclusivamente dominios reservados para documentación:

- Estudiantes: `@students.example.edu`
- Docentes: `@faculty.example.edu`

Antes de desplegar para una institución real, sustituye ambos dominios de forma coherente en `lib/security/institutional-email.ts`, las migraciones SQL, las pruebas y la documentación. El dominio docente continúa requiriendo una entrada activa en `teacher_allowlist`.

## Configuración local

Requisitos: Node.js 22 o superior y pnpm 11.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Variables necesarias:

| Variable | Exposición | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Pública | Supabase Auth y Realtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Pública | Cliente Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor | Operaciones confiables |
| `QR_SIGNING_SECRET` | Solo servidor | Firma de QR temporales |
| `DEVICE_COOKIE_SECRET` | Solo servidor | Firma de la identidad del navegador |
| `GEOAPIFY_API_KEY` | Solo servidor, opcional | Descripción aproximada de ubicación |
| `NEXT_PUBLIC_APP_URL` | Pública, opcional | Origen canónico en un despliegue estable |

No expongas `SUPABASE_SERVICE_ROLE_KEY`, `QR_SIGNING_SECRET` ni `DEVICE_COOKIE_SECRET` mediante variables `NEXT_PUBLIC_*`.

## Supabase

1. Crea un proyecto Supabase nuevo.
2. Activa Email + Password y configura las URL de redirección de Auth.
3. Ejecuta, en orden, los archivos de `supabase/migrations/`.
4. Añade los docentes autorizados a `public.teacher_allowlist`.
5. Activa Realtime para las tablas indicadas por las migraciones.
6. Configura la plantilla Recovery con `supabase/templates/recovery.html`.

Las migraciones incluyen RLS, ownership docente, privilegios mínimos, funciones transaccionales y restricciones de integridad. Las escrituras sensibles se realizan desde el backend con validación previa.

## Rutas principales

- `/login` — acceso y creación de cuenta.
- `/forgot-password` y `/reset-password` — recuperación de contraseña.
- `/teacher` — asignaturas, sesiones y asistencia.
- `/teacher/classes/[classId]` — alumnado y configuración de la asignatura.
- `/teacher/classes/[classId]/attendance` — matriz académica.
- `/teacher/sessions/[sessionId]/projection` — QR y registro Realtime.
- `/student` — resumen académico.
- `/student/classes/[classId]` — historial de la asignatura.
- `/student/scan` — escáner QR interno.
- `/attendance/[token]` — entrada desde la cámara nativa.

## Validación

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

La versión 1.0.0 fue preparada después de pruebas físicas en iPhone, Android y navegadores de escritorio. Consulta [docs/testing.md](docs/testing.md) para la matriz completa de pruebas automatizadas y manuales.

## Despliegue

El proyecto es compatible con Vercel. Configura las mismas variables en el entorno deseado y comprueba que `NEXT_PUBLIC_APP_URL`, las URL de redirección de Supabase Auth y el origen utilizado por los QR coincidan.

No se incluyen credenciales, archivos `.env.local`, artefactos de compilación ni configuración vinculada a un proveedor concreto.

## Documentación

- [Arquitectura](docs/architecture.md)
- [Base de datos](docs/database.md)
- [Seguridad](docs/security.md)
- [Autenticación institucional](docs/institutional-auth.md)
- [Sistema QR](docs/qr-system.md)
- [Geolocalización](docs/geolocation.md)
- [Pruebas](docs/testing.md)
- [Recuperación de contraseña](docs/password-recovery-hotfix.md)
- [Flujo de desarrollo](docs/development-workflow.md)

## Historial

La evolución funcional anterior a v1.0.0 se conserva de forma neutral en [CHANGELOG.md](CHANGELOG.md). El repositorio público comienza con un historial limpio para evitar publicar materiales o referencias de proyectos privados anteriores.
