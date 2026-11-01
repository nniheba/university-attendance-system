# Pruebas y QA — v1.0.0

## QA académica

Las pruebas automatizadas cubren el preflight que rechaza sesiones heredadas abiertas sin cambios parciales, migración histórica, periodos de matrícula, varios ciclos de baja/reactivación, privilegios/RLS, enlace tardío, archivo/restauración, elegibilidad estadística por intervalos y rechazo de asistencia QR/manual sin matrícula activa.

Phase 3 añade cobertura de prioridad efectiva, denominador, overrides sobre presencia/ausencia/sospecha/anulación, consistencia estudiante-docente, API/ownership, cruce de clases, razón obligatoria, privilegios/RLS, auditoría set/change/clear y CSV de matriz.

v0.6.3 añade cobertura de navegación por rol, breadcrumbs enlazados, menú móvil accesible, back links y proyección mínima. La cobertura de matrícula valida políticas exactas, RPC solo `service_role`, lista cerrada, sesión abierta, identidad, matrícula inactiva, periodo iniciado en `opened_at` y asistencia posterior. v0.6.5 actualiza separadamente la política del denominador del roster.

v0.6.4 añade cobertura de tokens visuales, Inter optimizada, sentence case, pie institucional, orden nombre/correo/avatar, skeletons de ruta, overlays accesibles, etiquetas específicas de mutación, limpieza de estados tras error y resolución de perfiles de matrícula en una única consulta.

La finalización de v0.6.4 cubre colores controlados, persistencia y validación de identidad de sesión, compatibilidad de sesiones históricas, cabeceras de matriz, historial estudiantil y ambos CSV académicos. Las pruebas de exportación verifican BOM, CRLF, zona horaria de Madrid y neutralización de fórmulas en todos los campos incorporados.

La última revisión añade pruebas de diálogos institucionales y auditoría de ausencia de `window.prompt/confirm/alert`; conversión Europe/Madrid en invierno, verano y salto DST; ownership, validación temporal, auditoría append-only y privilegios de la RPC de sesiones; recálculo/reordenación con overrides preservados; y activación de cámara desde gesto, denegación sin retry automático, fallback de constraints, retries limitados y liberación por visibilidad.

v0.6.5 valida el caso exacto de cinco sesiones cerradas computables con un solo registro: cuatro `not_registered`, un presente y 20%. También cubre corrección auditada a presente, el banco local de 56 frases, experiencia compartida en el escáner principal, celebración diferenciada de duplicados, feed reciente acotado, icono de perfil con fallback a iniciales y burbujas exclusivas de INSERT Realtime. Las pruebas del addendum verifican default y edición Sí/No, persistencia/RPC, deduplicación, límite de seis, tres carriles, privacidad, overlay acotado, QR memoizado y movimiento reducido.

v0.6.5.1 añade cobertura del origen canónico/fallback, URL absoluta, HMAC y vida de cuatro segundos; parser de origen/ruta estricto; compatibilidad raw heredada explícita; intención de login cerrada; registro nativo autenticado, duplicado, rol incorrecto, token expirado, matrícula inactiva y conflictos de dispositivo; además confirma un solo QR en proyección sin regresión de rotación, Realtime o burbujas.

Matriz manual conservada para validar cada despliegue. La versión 1.0.0 cerró satisfactoriamente su QA física antes de publicarse:

1. Crear una asignatura con grupo y curso académico.
2. Matricular un correo sin cuenta y confirmar “Cuenta aún no registrada”.
3. Crear/iniciar esa cuenta y comprobar el enlace automático.
4. Abrir dos sesiones desde la misma asignatura sin crear clases adicionales.
5. Registrar QR como estudiante activo; desactivar matrícula y confirmar `STUDENT_NOT_ENROLLED`.
6. Confirmar que asistencia manual también rechaza no matriculados.
7. Archivar la asignatura y comprobar que no permite sesiones nuevas; restaurarla.
8. Abrir una sesión histórica/proyección de v0.5.1 y comprobar que sigue resolviendo el nombre.
9. Observar Realtime, proyección, moderación y CSV para detectar regresiones.
10. Antes de aplicar v0.6 en QA, confirmar explícitamente que no existe ninguna sesión abierta; la migración no las cierra automáticamente.
11. Con dos asignaturas de denominadores distintos, confirmar que el resumen global usa la suma de oportunidades.
12. Abrir un detalle no matriculado cambiando el URL y confirmar que responde como no encontrado.
13. Revisar el historial en 390, 430 y desktop: Presente, Ausente y En revisión deben conservar contraste y no mostrar evidencia privada.
14. Abrir `/teacher/classes/[classId]/attendance`, recorrer horizontalmente 30+ columnas y comprobar cabecera/estudiante/% sticky sin desalineación.
15. Confirmar filtros, orden e inactivos; todo alumno mostrado en el roster debe tener «No registró» en cada sesión cerrada computable sin evidencia.
16. Corregir Presente → Ausente → Sospechosa y restaurar: estudiante, tarjeta docente, matriz y CSV deben coincidir tras cada paso.
17. Abrir el detalle: evidencia raw permanece, no aparecen coordenadas/hash, y auditoría muestra actor, transición, fecha y motivo en orden descendente.
18. Corregir una celda histórica «No registró» y confirmar auditoría; intentar una combinación cross-class y confirmar rechazo sin fila ni auditoría.
19. Exportar la matriz y abrirla en Excel/Sheets: BOM, CRLF, fechas Madrid, «No registró», porcentaje idéntico a la UI y fórmula neutralizada.
20. Revisar navegación a 375, 768 y desktop: sin overflow, nombre truncado, estado actual, Escape/clic exterior y cierre tras navegar.
21. Crear una clase de lista cerrada y otra abierta; confirmar los defaults y sobrescribir Sí/No al abrir cada sesión.
22. Con un alumno nuevo autenticado y navegador de confianza, escanear una sesión abierta: debe crear matrícula y asistencia, y la clase debe aparecer al volver al panel.
23. Con cinco sesiones cerradas y asistencia solo en la última, confirmar cuatro «No registró», una «Presente» y 20%, aunque la matrícula sea tardía.
24. Repetir con matrícula inactiva, QR expirado/manipulado, sesión cerrada y lista cerrada: ninguna ruta debe crear/reactivar matrícula.
25. Abrir cada acción sensible y confirmar foco, Escape/cancelación, error en línea y pending sin overlay duplicado.
26. Editar nombre/color/hora de una sesión cerrada; comprobar reordenación de columnas, porcentaje estable, historial/CSV actualizado y override conservado.
27. En Chrome Android, entrar al escáner y verificar que no aparece ningún permiso hasta pulsar **Activar cámara**; denegar, rehabilitar en ajustes y reintentar manualmente.
28. En iPhone/Safari, repetir activación, escaneo y retorno tras segundo plano; debe exigir **Reactivar cámara** y no perder compatibilidad.
29. Registrar asistencia y comprobar una sola frase inspiracional, ondas suaves sin bloqueo y ausencia de movimiento con la preferencia reducida.
30. En proyección, registrar al menos cinco alumnos rápidamente con la opción activa: cada burbuja debe aparecer una sola vez dentro del panel de registros, el feed debe actualizarse y el QR único debe permanecer inmóvil entre sus intercambios atómicos.
31. Desactivar la opción desde **Editar sesión**, registrar otro alumno y confirmar que el feed/contador se actualiza sin burbuja; reactivarla y confirmar que solo los INSERT posteriores vuelven a animarse.
32. Repetir a 390 px, 430 px y desktop, y con `prefers-reduced-motion`: ninguna burbuja debe cubrir el QR, provocar overflow o impedir interacción; con movimiento reducido solo debe verse un fundido breve.

## QA física de QR y cámara

### TEST A — NATIVE CAMERA + EXISTING ACCOUNT

1. Login as student once in mobile browser.
2. Project session QR.
3. Open native phone camera.
4. Scan QR.
5. Browser opens.
6. Attendance should register automatically.
7. Success experience appears.
8. Teacher list updates Realtime.
9. Bubble appears if enabled.

### TEST B — NATIVE CAMERA + NO SESSION

1. Sign out.
2. Scan QR with native camera.
3. App opens.
4. Login/signup.
5. Land on `/student/scan`.
6. Attendance-specific message appears.
7. Tap **Activar cámara**.
8. Scan current QR again.
9. Attendance registers.

### TEST C — INTERNAL SCANNER

1. Student logged in.
2. Open `/student/scan`.
3. Tap **Activar cámara**.
4. Scan the SAME QR.
5. URL is parsed.
6. Attendance registers.

### TEST D — EXPIRED QR

1. Capture QR visually.
2. Wait more than 4 seconds.
3. Open/scan old value.
4. It must fail safely.
5. Student is instructed to rescan.

### TEST E — INACTIVE STUDENT

1. Teacher deactivates enrollment.
2. Student scans.
3. Verify `ENROLLMENT_INACTIVE` behavior.
4. Confirm no automatic reactivation.

### TEST F — ANDROID

Chrome Android: camera permission, native QR path and internal scanner. Explicitly confirm `Permissions-Policy: camera=(self)`.

### TEST G — iPHONE

Safari/native Camera, internal web scanner and duplicate attendance behavior.

`attendance.example.edu` es un dominio reservado de documentación; cada despliegue debe configurar su origen real.

## Automatización

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Las pruebas focalizadas v0.6.5.1 cubren el QR URL único, tokens de 4000 ms con tolerancia de 750 ms, parser estricto, rotación atómica, cámara, vínculo de navegador, GPS opcional, proyección, Realtime, burbujas y compatibilidad raw temporal.

Durante FEATURE se ejecutan:

```bash
pnpm test tests/token.test.ts tests/qr-rotation.test.ts tests/fast-scanner.test.ts \
  tests/fast-attendance-api.test.ts tests/fast-attendance-database.test.ts \
  tests/student-flow.test.ts tests/projection-realtime.test.ts tests/teacher-authorization.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Por el cambio de base de datos/API/Realtime, esta FEATURE exige también suite completa y `pnpm build` antes del push.

Las pruebas focalizadas v0.5 cubren dominio institucional exacto, normalización, nombres derivados, alta e inicio con contraseña, mínimo de ocho caracteres, errores sanitizados, sesión SSR, ausencia de UI OTP, bootstrap idempotente, rol por allowlist, guards docente/estudiante, privacidad de allowlist, inmutabilidad de rol, ownership del perfil estudiante y migración PGlite. La asistencia prueba identidad autenticada, nombre falso ignorado, duplicado por usuario, homónimos permitidos, sesiones distintas, protección por dispositivo y compatibilidad histórica con `student_user_id = NULL`.

También cubre validación y persistencia del perfil, prioridad del nombre inicial, allowlist de avatares, identidad en cabecera, RLS propia/ajena, fusión/deduplicación/orden de INSERT Realtime, exposición mínima en proyección y CSV con asignatura, ownership, BOM, CRLF, escaping y neutralización de fórmulas.

Las pruebas de rotación comprueban: carga inicial permitida; frame anterior durante refresh; intercambio atómico; límite visual sin desaparición; fallo conservando imagen; recuperación en reintento; ausencia de URL cruda.

Las pruebas de compatibilidad de Auth conservan la cobertura del token hash heredado, destino inseguro y estados sin sesión, pero ese flujo ya no aparece en la interfaz activa.

## Regresión v0.3 ya verificada — 21/09/2026

- `/`, `/login`, redirección anónima de `/teacher`, cabeceras de seguridad y ausencia de overlays: correctos.
- Teacher A/B: login, refresh y logout correctos; A crea y lee recursos, B recibe 403, anónimo 401.
- RLS QA: A ve sus filas, B no; `anon` sin SELECT y `authenticated` solo SELECT directo.
- QR base: vigente aceptado, manipulado y expirado rechazados; cierre invalida QR y grant.
- Realtime: Teacher A recibió la primera asistencia sin refresh; aislamiento de Teacher B confirmado por RLS.
- Alumno: GPS válido aceptado; fuera/precisión insuficiente rechazados; duplicados de dispositivo/nombre correctos; mismo dispositivo permitido en otra sesión.
- Rotación: 12 frames distintos, ninguno vacío/incompleto, sin loading intermedio, tamaño constante; fallo/reintento correcto.
- CSV: UTF-8 con BOM y CRLF, ownership 200/403/401 y protección de fórmulas comprobada.
- UI: sin overflow en 390, 430, 768, 1024 y 1440 px; modo proyección sin datos sensibles.
- Accesibilidad: 0 violaciones Axe WCAG 2 A/AA; dos iconos decorativos requieren revisión manual de contraste.
- Suite v0.3: 11 archivos y 92 pruebas, lint, TypeScript y build aprobados.

## QA institucional v0.5 requerida

- Habilitar Email/password en Supabase QA y desactivar **Confirm email** para obtener sesión inmediata al crear cuenta.
- Aplicar `20260922145139_institutional_accounts.sql` únicamente a QA después de revisión.
- Añadir una cuenta docente de prueba a la allowlist; no confirmar correos reales en Git.
- Recrear las cuentas QA que solo usaban OTP o asignarles una contraseña administrativamente.
- Verificar estudiante por defecto, docente allowlisted, sesión persistente y logout para ambos roles.
- Intentar Gmail, subdominio, dominio lookalike, contraseña corta/incorrecta, confirmación distinta y fallo de red.
- Confirmar que un estudiante recibe redirección/403 en rutas y APIs docentes.
- Editar el nombre de estudiante y comprobar que correo, rol y `user_id` no cambian.
- Escanear QR sin sesión: iniciar sesión, llegar a `/student` con aviso y volver a escanear un QR vigente.
- Registrar dos cuentas con el mismo nombre en una sesión y comprobar que ambas aparecen en Realtime/CSV.
- Repetir la misma cuenta y el mismo dispositivo para confirmar los conflictos independientes.

## Regresión visual v0.4 requerida

- Validar `/`, `/login`, `/teacher`, alumno y proyección a 390, 430, 768, 1024 y 1440 px sin overflow.
- Observar al menos 10 rotaciones de aproximadamente 4 segundos: sin blanco, loading intermedio, salto de layout ni animación del QR.
- Confirmar que la barra progresa suavemente y que `prefers-reduced-motion` elimina la transición.
- Comprobar crear cuenta/iniciar sesión, recarga con sesión persistente y cierre de sesión para estudiante y docente.
- Confirmar CSP, estilos Tailwind y logotipo local en los estados de error de Auth.
- Crear/editar el perfil, recargar y comprobar que nombre/avatar persisten, aparecen en cabecera y el nombre actualizado se copia a una clase nueva.
- Observar varios INSERT Realtime en proyección: orden ascendente, sin duplicados, animación solo en la fila nueva, lista con scroll y QR inmóvil.
- Exportar CSV y confirmar la columna `Asignatura` en todas las filas en Excel y Google Sheets.

## QA física aún requerida

### v0.5.1 — escáner rápido

1. Abrir `/student/scan` en Safari iPhone, Chrome iPhone y Chrome Android; conceder cámara y confirmar que usa la trasera.
2. Denegar/restaurar permiso, probar dispositivo sin cámara e intentar HTTP no seguro; comprobar mensajes y que no queda la cámara activa.
3. Probar 1×/2×/3× en un móvil con zoom de hardware y otro sin él.
4. Escanear un QR vigente: la solicitud comienza al detectarlo mientras el GPS opcional se resuelve en segundo plano, sin botón adicional.
5. Mantener un QR antiguo: aparece «El código cambió» y el escáner reanuda automáticamente.
6. Repetir el mismo estudiante: estado informativo «ASISTENCIA YA REGISTRADA» sin fila nueva.
7. Cambiar de cuenta en el mismo navegador: `DEVICE_BOUND_TO_OTHER_ACCOUNT`; usar la misma cuenta en otro navegador: `ACCOUNT_DEVICE_MISMATCH`.
8. Escanear con la cámara nativa del teléfono autenticado y confirmar el mismo resultado automático.
9. Observar al menos 10 rotaciones de cuatro segundos: sin frame vacío, cambio de tamaño ni URL/token visible.
10. Abrir la proyección en otra pestaña a 16:9: QR dinámico y lista visibles; el panel docente permanece utilizable.
11. Comprobar Realtime, contador y animación con `prefers-reduced-motion` normal/activo.
12. Revisar que la proyección no muestra ciudad, región, precisión ni distancia; el panel privado solo dice «Ubicación aproximada de red».
13. Exportar CSV y confirmar `Origen`, `Estado` y `Ubicación`, sin filas anuladas ni coordenadas.
14. Denegar GPS, provocar timeout, usar mala precisión y una posición fuera de zona: todas las asistencias QR válidas se aceptan con el estado privado correspondiente.
15. Añadir asistencia manual con estudiante existente e inexistente; probar duplicado, nota, marcar/quitar sospecha, anular y reinscribir.
16. Restablecer por correo el dispositivo de un alumno y comprobar que el navegador nuevo se vincula mientras el anterior deja de ser válido.
17. Solicitar recuperación para cuenta existente y desconocida: mismo mensaje; abrir enlace válido, cambiar contraseña y comprobar que exige login nuevo.

### Evidencia GPS opcional

1. Escaneo con cámara nativa y permiso real de ubicación en Safari y Chrome de iPhone.
2. Escaneo y ubicación precisa en Chrome Android.
3. Safari macOS y Chrome desktop con permisos permitidos, denegados y restaurados.
4. GPS real dentro, en el borde y fuera del radio; interiores y precisión aproximada.
5. VPN/Private Relay con país de red diferente y metadatos de red ausentes.
6. Borrado de cookies, modo privado y cambio de navegador para confirmar que no sustituyen el vínculo existente sin reset docente.
7. Teclado, VoiceOver/TalkBack y contraste de iconos decorativos.

Las migraciones hasta `20260924125244_navigation_flexible_enrollment.sql` ya fueron gestionadas únicamente en QA. `20260924172944_session_identity_colors.sql` permanece local; no aplicarla a QA o Production sin una autorización separada.
