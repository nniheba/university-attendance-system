# Base de datos — v1.0.0

## Fundación académica

`public.classes` añade `group_name`, `academic_year`, `status`, `updated_at` y `archived_at`. Durante la migración, todas las clases pre-v0.6 se marcan `archived`; no se elimina ninguna clase, sesión ni asistencia. Las nuevas clases usan `active` por defecto.

`public.class_enrollments` conserva una fila estable por `(class_id, student_email)`. Solo admite el dominio exacto `@students.example.edu`, mantiene `student_user_id` nullable para altas previas a Auth y refleja el estado actual `active/inactive` con `unenrolled_at`. Un índice parcial impide duplicar el mismo usuario dentro de una clase.

`public.class_enrollment_periods` es la fuente histórica autoritativa del ciclo de matrícula. Cada alta crea un intervalo abierto; desactivar fija `ended_at` y reactivar crea otro intervalo sin modificar el anterior. El índice parcial `class_enrollment_periods_one_open_key` permite como máximo un periodo abierto por matrícula. Estos intervalos conservan auditoría de altas/bajas; el cálculo ordinario de asistencia usa el roster y todas las sesiones cerradas computables de la clase.

Ambas tablas tienen RLS habilitado y cero privilegios directos para `anon` y `authenticated`; `service_role` gestiona altas y transiciones mediante RPC atómicas invocadas por endpoints validados. Reagregar una matrícula inactiva reutiliza exactamente la misma transición que la acción Reactivar. Las funciones `register_attendance_if_open` y `add_manual_attendance` vuelven a comprobar una matrícula activa dentro de la transacción.

`sessions.counts_toward_attendance` prepara el denominador estadístico. Una asistencia válida es activa/no anulada; manual, QR y sospechosa cuentan provisionalmente. Una sesión abierta o no computable no entra en el denominador. No existen filas de ausencia.

«No registró» se deriva cuando una sesión cerrada computable no tiene evidencia de asistencia para un alumno del roster. Cuenta como ausencia en el denominador, pero no crea una fila artificial. La migración `class_roster_attendance_policy` actualiza únicamente las validaciones de corrección para que esas celdas históricas sigan siendo editables; `attendance_overrides` y su historial append-only permanecen intactos. El addendum v0.6.5 añade solo `sessions.enable_projection_bubbles boolean not null default true`, sin nuevas tablas.

v0.6.3 añade `classes.enrollment_mode` (`closed | self_enroll`) como valor predeterminado docente y `sessions.allow_self_enrollment` como decisión histórica inmutable para cada apertura. `self_enroll_student_for_session` es ejecutable solo por `service_role`: bloquea la sesión, valida cuenta/correo/rol, clase activa y permiso de sesión, conserva las bajas intencionales y converge sobre los índices únicos existentes. La nueva matrícula usa `enrolled_at = session.opened_at`; el trigger existente abre el periodo en ese mismo instante para preservar el historial administrativo.

Phase 2 no añadió esquema. Phase 3 crea `attendance_overrides`, una fila reversible por `(session_id, enrollment_id)`, y `attendance_override_audit`, historial append-only de `set_override`, `change_override` y `clear_override`. La razón normalizada es obligatoria y admite 1–500 caracteres. Las FK preservan clase, sesión, matrícula y actor; eliminar un override solo pone `override_id` del historial a `NULL`.

Un trigger verifica clase común y sesión cerrada/computable antes de cualquier INSERT/UPDATE. Los RPC `set_attendance_override` y `clear_attendance_override` bloquean objetivos, vuelven a validar ownership docente y relación, y escriben override/auditoría en una transacción. Una matrícula tardía no bloquea la corrección de una celda histórica «No registró».

## Migraciones

1. `202609210001_attendance_alpha.sql`: tablas, constraints, RPC y RLS inicial.
2. `202609210002_attendance_hardening.sql`: dispositivo, geofence, red aproximada y RPC reforzada.
3. `20260921142234_institutional_teacher_auth.sql`: ownership docente y RLS privada.
4. `20260921152310_teacher_least_privilege.sql`: `authenticated` conserva solo SELECT en tablas académicas.
5. `20260921213707_teacher_profiles.sql`: perfil y avatar docente.
6. `20260922145139_institutional_accounts.sql`: identidad institucional, perfil de estudiante y asistencia autenticada.
7. `20260922161109_institutional_email_domains.sql`: dominio estudiantil exacto y dominio docente con allowlist.
8. `20260922200450_fast_attendance_flow.sql`: sesiones sin GPS y registro rápido por QR.
9. `20260923073137_profile_name_immutability.sql`: nombres institucionales inmutables.
10. `20260923114500_attendance_integrity.sql`: navegador de confianza, evidencia GPS, moderación, auditoría y anulación lógica.
11. `20260923131434_academic_foundation.sql`: preflight de sesiones cerradas, asignaturas persistentes, matrículas con periodos históricos, compatibilidad histórica y enforcement académico.
12. `20260924091500_attendance_overrides.sql`: correcciones académicas reversibles, auditoría append-only, RLS/grants mínimos y RPC atómicas de service role.
13. `20260924104051_override_audit_append_only.sql`: revoca UPDATE/DELETE/TRUNCATE del historial de overrides a `service_role`.
14. `20260924125244_navigation_flexible_enrollment.sql`: políticas de matrícula de clase/sesión y automatrícula QR service-only con periodo iniciado al abrir la sesión.
15. `20260924172944_session_identity_colors.sql`: color controlado de asignatura y nombre/color snapshot de sesión.
16. `20260924181713_session_metadata_audit.sql`: historial append-only de metadatos de sesión y RPC atómica `update_session_details`.
17. `20260925103000_class_roster_attendance_policy.sql`: permite corregir cualquier sesión cerrada computable del roster sin eliminar periodos ni debilitar ownership/auditoría.
18. `20260929103000_projection_bubbles.sql`: preferencia de burbujas por sesión y RPC service-only para editar metadatos y preferencia atómicamente, conservando el RPC anterior para clientes ya desplegados.

El estado remoto debe comprobarse antes de aplicar migraciones pendientes. La decimoctava se creó localmente para revisión y no se ha aplicado remotamente.

Los valores de color permitidos son `blue`, `navy`, `cyan`, `green`, `amber`, `red`, `purple` y `slate`. La base rechaza valores CSS o hexadecimales arbitrarios. Los nombres nuevos de sesión se validan entre 1 y 120 caracteres después de `btrim`.

`update_session_details` se ejecuta solo con `service_role`, bloquea la sesión, verifica que `p_actor_user_id` sea el docente propietario, mantiene `class_id` inmutable y valida la relación temporal (`opened_at < closed_at` si está cerrada; no futuro si está abierta). La actualización y la fila de `session_audit_log` ocurren en la misma transacción. `anon` y `authenticated` no tienen acceso directo ni `EXECUTE`; `service_role` solo posee `SELECT`/`INSERT` sobre el audit, sin `UPDATE`, `DELETE` ni `TRUNCATE`.

`update_session_details_with_projection` aplica las mismas validaciones y auditoría, y además persiste `enable_projection_bubbles`. Un valor `NULL` conserva el ajuste actual para compatibilidad. `anon` y `authenticated` no reciben `EXECUTE`; las escrituras siguen pasando por el backend validado con `service_role`.

## Integridad v0.5.1 final

`student_trusted_devices` aplica `PRIMARY KEY(user_id)` y `UNIQUE(device_hash)`. Solo el propio usuario puede leer su vínculo; las escrituras son backend/service role. `attendance` añade origen, snapshot de correo, revisión, notas, motivo manual, actor, evidencia GPS y campos de anulación.

Los índices únicos por estudiante, dispositivo y correo son parciales con `voided_at is null`. Una anulación conserva la fila/auditoría y permite una posterior reinscripción activa. `attendance_audit_log` no concede acceso directo a `anon` ni `authenticated`; registra altas manuales, revisión, notas, anulaciones y resets de dispositivo.

La regla de verificación exige QR verificado para `source='qr'` y QR no verificado para `source='manual'`. Las RPC de asistencia se conceden exclusivamente a `service_role`.

## Cambio v0.5.1

`sessions.latitude`, `sessions.longitude` y `sessions.allowed_radius_m` pasan a ser opcionales. Las coordenadas históricas no se actualizan ni eliminan.

La restricción distingue `source='qr'` (QR verificado) de `source='manual'` (QR no verificado y motivo obligatorio). Las filas QR pueden incluir evidencia GPS derivada; las filas históricas conservan sus valores.

La RPC QR nunca recibe coordenadas persistibles; recibe únicamente evidencia ya derivada por el backend:

```text
session_id
student_user_id
device_hash
location_accuracy
distance_from_center_m
gps_status
network_city
network_region
network_country
network_country_code
```

La función usa `security invoker`, bloquea la sesión, exige estado abierto, obtiene identidad y nombre desde las tablas institucionales y aplica los conflictos activos de estudiante y dispositivo antes de insertar. Las RPC de alta manual y moderación escriben su auditoría en la misma transacción. `PUBLIC`, `anon` y `authenticated` no pueden ejecutarlas; solo `service_role` recibe `EXECUTE`.

## Identidad institucional

### `institutional_accounts`

Una fila por `auth.users.id`, correo normalizado y rol `student | teacher`. Los estudiantes usan exactamente `@students.example.edu`. El dominio `@faculty.example.edu` requiere una entrada docente activa.

### `teacher_allowlist`

Acepta únicamente `@faculty.example.edu`. No tiene políticas ni grants para `anon` o `authenticated` y es la única fuente que autoriza rol docente durante el bootstrap confiable.

### `student_profiles`

Una fila por estudiante. El usuario autenticado puede leer su perfil; el nombre institucional permanece inmutable después del bootstrap. Correo, usuario y rol no se confían al navegador.

## Unicidad y compatibilidad histórica

`attendance.student_user_id` referencia `auth.users(id) on delete set null`. Índices únicos parciales aplican `(session_id, student_user_id)`, `(session_id, device_hash)` y `(session_id, student_email_snapshot)` solo a filas no anuladas. Las filas históricas pueden mantener identidad/dispositivo en `NULL`.

La RPC v0.5.1 consulta el perfil estudiantil autoritativo y genera el snapshot `full_name`/`normalized_name`; no recibe nombres del navegador. Dos cuentas diferentes pueden compartir nombre, pero una cuenta o un dispositivo no pueden registrarse dos veces en la misma sesión.

## RLS, grants y Realtime

- `anon`: sin acceso directo a tablas académicas o institucionales.
- `authenticated`: lectura académica filtrada por ownership docente y lectura propia de identidad/perfil.
- `teacher_allowlist`: service role únicamente.
- escrituras de clase, sesión y asistencia: backend validado con service role.
- `attendance_overrides`: CRUD solo `service_role`; `attendance_override_audit`: SELECT/INSERT solo `service_role`, sin UPDATE/DELETE para conservar append-only.
- Realtime continúa publicando `attendance`; v0.5.1 no modifica la publicación ni crea canales adicionales.
