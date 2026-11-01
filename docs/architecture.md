# Arquitectura — v1.0.0

Las asignaturas tienen una identidad visual controlada. Al abrir asistencia, la sesión guarda su propio nombre y una copia del color elegido; cambiar posteriormente el color de la asignatura solo afecta a sesiones futuras. Matriz, historial, proyección y exportaciones reciben estos campos dentro de sus consultas agrupadas existentes.

## Base académica

```text
Teacher
  → persistent Class
      → class_enrollments → class_enrollment_periods → institutional student identity
      → Sessions → Attendance
```

`classes` sigue siendo la entidad académica y `sessions.class_id` conserva la relación histórica. El panel docente usa APIs server-side con `requireTeacher()` y ownership por `teacher_id`; el navegador nunca elige propietario. Abrir asistencia selecciona una clase activa existente y ya no crea otra clase.

La matrícula puede existir antes que la cuenta Auth. `student_email` normalizado es la identidad académica inicial; al aparecer una cuenta institucional coincidente, el backend enlaza `student_user_id` de forma idempotente. `class_enrollments` representa el estado actual y `class_enrollment_periods` conserva cada intervalo histórico: desactivar cierra el periodo abierto y reactivar crea uno nuevo mediante una única transición atómica.

En v0.6.3 cada clase define un valor predeterminado `closed | self_enroll`, pero cada sesión persiste su decisión autoritativa en `allow_self_enrollment`. Si no existe matrícula, `/api/attendance/scan` solo invoca `self_enroll_student_for_session` después de validar QR vigente, sesión abierta, identidad estudiantil y navegador de confianza. La RPC bloquea la sesión, rechaza matrículas inactivas y crea el periodo desde `session.opened_at`; después la RPC de asistencia vuelve a exigir matrícula activa.

## Lectura académica y matriz docente

`lib/academic/student-statistics.ts` enlaza primero matrículas creadas por correo y carga por lotes matrículas, sesiones y únicamente la asistencia del usuario autenticado. La identidad procede siempre de `requireStudent()` o de la sesión SSR, nunca de parámetros del navegador.

La lógica pura compartida produce el historial y agrega oportunidades ponderadas. Para cada matrícula del roster, toda sesión cerrada con `counts_toward_attendance = true` es una oportunidad: sin evidencia deriva `not_registered`, reduce el porcentaje igual que una ausencia y permanece corregible. Los periodos de matrícula continúan como historial de ciclo de vida, no como vía para excluir sesiones ordinarias del denominador. `lib/academic/attendance-matrix.ts` carga en lotes clase, matrículas, sesiones/asistencias, overrides y auditoría; indexa por sesión/identidad y calcula hasta miles de celdas en memoria sin peticiones por celda.

La edición de metadatos parte del resumen de columna de la matriz. El cliente convierte fecha/hora `Europe/Madrid` a un instante UTC validado y envía únicamente la acción explícita `update_details`. La API autentica al docente y la RPC bloquea la sesión, repite ownership/validación, actualiza e inserta auditoría atómicamente. Después se recarga la matriz completa: la columna se reordena por `opened_at` y la elegibilidad se deriva de nuevo; ningún override se mueve ni elimina.

```text
override docente    → estado corregido
sin evidencia       → not_registered
evidencia raw       → suspicious | present | absent
```

La misma derivación efectiva alimenta historial/porcentaje del estudiante, media ponderada docente, matriz y CSV. «No registró» es un estado calculado, no una fila nueva ni un valor persistido; el docente puede abrir la celda y aplicar/restaurar un override usando el flujo auditado existente. La UI nunca reescribe ni elimina la asistencia QR/manual original.

## Flujo principal

```text
Institutional user
  → Supabase email + password Auth
  → SSR cookie session
  → trusted account bootstrap
       → student domain → student + student_profiles
       → teacher allowlist active → teacher + teacher_profiles
       → teacher domain without allowlist → denied

Teacher → /teacher → owned Class → open Session
  → absolute signed attendance URL QR (4 s) → atomic rotation
  → separate protected Projection tab

Authenticated student → /student/scan
  → rear camera → native BarcodeDetector or local worker fallback
  → POST /api/attendance/scan { token, location? }
  → server Auth identity + token/session/trusted-device validation
  → optional service-only self-enrollment RPC for this open session
  → security-invoker attendance RPC with service role
  → attendance(student_user_id + authoritative name snapshot)
  → one private Realtime channel per document → dashboard / projection

Native phone camera → /attendance/[token]
  → authenticated student → same atomic scan endpoint
  → unauthenticated → safe login intent → /student/scan → rescan current QR
```

La navegación global se deriva del rol autenticado. El logo enlaza directamente a `/teacher` o `/student`; los breadcrumbs son enlaces deterministas y el menú móvil ofrece Escape, cierre exterior, estado actual y objetivos táctiles de 44 px. La proyección mantiene una cabecera mínima sin menú interactivo.

## Límites de confianza

El navegador envía el token y, opcionalmente, coordenadas efímeras. El backend obtiene el usuario desde Supabase Auth, vuelve a consultar la cuenta institucional, deriva `session_id` del token firmado, lee el nombre desde `student_profiles`, valida el navegador de confianza y deriva la evidencia GPS sin persistir coordenadas exactas.

El cliente no decide rol, `teacher_id`, `student_user_id`, nombre almacenado, sesión objetivo ni banderas de verificación. La API rechaza tokens manipulados, expirados, sesiones cerradas, usuarios no estudiantes y conflictos de identidad/dispositivo. PostgreSQL repite las invariantes críticas dentro de la transacción.

Una persona sin sesión que abre `/attendance/[token]` se autentica con una intención interna cerrada y vuelve a escanear. El token de cuatro segundos no se conserva a través de un login largo ni se convierte en un redirect arbitrario. Una cuenta docente nunca cruza al registro estudiantil.

## QR y rotación

El único QR contiene la URL absoluta `<APP_ORIGIN>/attendance/<signed-token>`. `NEXT_PUBLIC_APP_URL` tiene prioridad cuando se configura intencionadamente; en Preview/local se usa el origen actual. El token HMAC conserva `session_id`, emisión, expiración y nonce.

El panel muestra cada frame saludable durante cuatro segundos completos. Al finalizar ese plazo prepara la siguiente imagen manteniendo visible la anterior y solo la intercambia cuando el reemplazo está listo; los fallos disparan reintento sin vaciar la tarjeta. La vida criptográfica permanece en 4000 ms y la tolerancia de reloj en 750 ms como margen de handoff.

## Perfiles e historial

`institutional_accounts` contiene identidad y autorización. `teacher_profiles` y `student_profiles` contienen presentación. El nombre inicial se deriva de la parte local del correo; no se inventan acentos.

La asistencia guarda snapshots de nombre/correo junto con `student_user_id`. Las altas manuales usan perfil autoritativo o derivan el nombre del correo si aún no existe cuenta. La anulación es lógica y cada cambio sensible queda auditado.

## Realtime y proyección

Cada documento (panel o pestaña de proyección) mantiene un único canal Realtime de `attendance`, autenticado y filtrado por sesión, escuchando INSERT y UPDATE. RLS limita la lectura al docente propietario. La proyección no muestra URL, token, correo, GPS, red, revisión, notas ni dispositivo.

La proyección v0.6.5.1 conserva un feed acotado de los ocho registros más recientes. Las asistencias vinculadas a un perfil muestran el icono institucional de perfil; las filas históricas sin vínculo usan iniciales. Cada `INSERT` activo se incorpora primero al estado autoritativo y, si la sesión lo permite, crea una burbuja efímera deduplicada por ID. La cola admite hasta seis burbujas en tres carriles y vive dentro del panel derecho, con `pointer-events: none`; el único QR está memoizado y no se reinicia, reordena ni queda cubierto. Desactivar el ajuste solo afecta a INSERT futuros y no reproduce registros al reactivarlo. `prefers-reduced-motion` sustituye el desplazamiento por un fundido breve. El éxito del alumno usa en ambos flujos una experiencia compartida, ondas CSS ligeras y una frase local determinista, sin llamadas externas ni nuevas dependencias.

## Privacidad y señales auxiliares

GPS se solicita en segundo plano como evidencia opcional. PostgreSQL no recibe coordenadas exactas del alumno, IP, cookie cruda, `user-agent` ni identidad física. GPS y ubicación aproximada de red nunca bloquean una asistencia QR válida.
