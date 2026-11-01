# Seguridad v1.0.0

Los colores se representan mediante una clave enumerada validada en API y mediante `CHECK` en PostgreSQL; nunca se acepta CSS aportado por el navegador. Ambos CSV aplican comillas, escape y neutralización de fórmulas a todos los campos textuales, conservan BOM UTF-8, CRLF y la zona horaria `Europe/Madrid`.

## Matrícula y separación docente

- Toda operación académica exige `requireTeacher()` y `classes.teacher_id === auth.uid()` comprobado en backend.
- El navegador no puede aportar `teacher_id`, `student_user_id` ni el rol.
- `class_enrollments` y `class_enrollment_periods` no son legibles ni modificables directamente por `anon` o `authenticated`.
- El correo de matrícula se normaliza y solo permite el dominio estudiantil exacto.
- QR y asistencia manual exigen matrícula activa; PostgreSQL repite la comprobación para evitar saltos del frontend y carreras.
- La automatrícula solo existe en el endpoint de escaneo, después de autenticar al estudiante y validar QR dinámico, sesión abierta y navegador de confianza. Login, URLs de clase, QR estático y asistencia manual no la activan.
- `self_enroll_student_for_session` es exclusiva de `service_role`, bloquea la sesión y valida `allow_self_enrollment`, clase activa y coincidencia exacta en `institutional_accounts`.
- Una matrícula inactiva devuelve `ENROLLMENT_INACTIVE`; nunca se reactiva por escaneo. Los índices únicos de correo y usuario, más el bloqueo de sesión, hacen segura la concurrencia.
- Vincular una cuenta tardía requiere coincidencia con `institutional_accounts.email`; una identidad no puede reclamar el correo de otra.
- Desactivar una matrícula cierra atómicamente su periodo abierto; reactivar crea uno nuevo y nunca reabre ni sobrescribe periodos anteriores. No existe borrado desde la aplicación.
- La migración v0.6 aborta antes del archivo histórico si detecta alguna sesión heredada abierta.
- Las APIs académicas estudiantiles derivan usuario y correo desde la sesión autenticada y devuelven 404 para clases sin relación de matrícula.
- El historial del estudiante expone únicamente fecha, hora, estado y origen QR/manual. Excluye notas docentes, motivo manual, GPS, red, dispositivo y auditoría.
- Los registros sospechosos se presentan con el texto neutral «En revisión» y siguen contando provisionalmente como presentes.
- Las correcciones de matriz solo pasan por APIs con `requireTeacher()` y ownership, y por RPC ejecutables únicamente por `service_role`.
- PostgreSQL rechaza sesión/matrícula de clases distintas aunque un docente posea ambas, y rechaza cualquier override sobre una celda N/A.
- La edición de sesión acepta solo nombre, fecha/hora y color; `class_id` no forma parte de la operación. Una RPC exclusiva de `service_role` bloquea la sesión, vuelve a comprobar ownership y registra valores anteriores/nuevos en una tabla append-only sin acceso de navegador.
- Cada cambio exige motivo y crea auditoría en la misma transacción; restaurar elimina solo el override actual, nunca su historial ni la evidencia raw.
- Estudiantes no reciben razones, auditoría ni notas. La matriz privada tampoco expone coordenadas ni hashes de dispositivo.

## Autenticación y roles

La aplicación acepta únicamente los dominios exactos `students.example.edu` y `faculty.example.edu`, validados en servidor antes de contactar Supabase Auth. Supabase verifica correo y contraseña y establece la sesión en cookies SSR. No se guardan tokens de Auth manualmente en `localStorage`.

El dominio de estudiantes asigna `student`. El dominio de personal nunca cae por defecto a estudiante: el backend exige una entrada activa en la allowlist privada para asignar `teacher`; de lo contrario deniega el acceso. El navegador no elige el rol ni accede a la allowlist. Todas las rutas sensibles usan guards comunes para usuario institucional, docente o estudiante.

Una cuenta externa autenticada se rechaza y se cierra de forma segura. Una cuenta estudiante recibe 403 en APIs docentes y no accede a `/teacher`; una cuenta docente no puede usar el endpoint de registro estudiante.

## Autoridad de asistencia

El flujo activo v0.6.5.1 codifica una URL absoluta `/attendance/[token]`; la cámara nativa la abre y el escáner interno valida origen/ruta antes de extraer el mismo QR firmado. Ambos envían el token y, opcionalmente, una lectura GPS efímera a `/api/attendance/scan`. El servidor obtiene `student_user_id` de la sesión Auth, deriva `session_id` del token, lee el nombre desde `student_profiles` y calcula los hashes desde una cookie HttpOnly firmada. No confía en nombre, rol, usuario, sesión ni flags enviados por el navegador.

La defensa combina:

- HMAC-SHA-256 del QR de 4 segundos y tolerancia máxima de 750 ms;
- nonce aleatorio en cada emisión;
- endpoint único sin grant intermedio de 10 minutos;
- cookie firmada, hash estable de confianza y hash aislado por sesión;
- sesión abierta bloqueada durante inserción;
- unicidad por usuario/sesión y por dispositivo/sesión;
- RLS y RPC ejecutable solo por service role.

La identidad de navegador no es IMEI, número de serie, identidad física ni attestation. Borrar cookies, usar incógnito u otro navegador crea otra identidad; como la cuenta ya conserva su vínculo, esa identidad nueva queda bloqueada hasta un restablecimiento docente auditado. No existe OTP de dispositivo.

GPS y ubicación aproximada de red son evidencia informativa: permiso denegado, timeout, ausencia, mala precisión o estar fuera de la zona nunca rechazan una asistencia QR válida. Latitud y longitud del estudiante solo existen durante la petición; PostgreSQL recibe estado, precisión y distancia derivada.

## Threat model mínimo

| Amenaza | Mitigación |
| --- | --- |
| Cuenta externa | Dominio exacto validado antes de Auth y otra vez al bootstrap |
| Autoasignación docente | Allowlist privada, rol escrito solo con service role |
| Acceso estudiante a gestión | Guards por rol, ownership server-side y RLS |
| Enumeración o contraseña incorrecta | Error genérico sin revelar si la cuenta existe ni detalles del proveedor |
| Captura o envío del QR | Token de 4 s, cuenta institucional y dispositivo por sesión |
| Reutilización | Expiración, dispositivo, usuario y cierre de sesión de clase |
| Incorporación a una clase arbitraria | Automatrícula solo tras QR dinámico vigente y permiso persistido en la sesión |
| Evasión de una baja docente | Matrícula inactiva bloqueada; solo el docente puede reactivarla |
| Manipulación frontend | Backend deriva rol, identidad, nombre y verificaciones |
| URL QR con origen/ruta maliciosos | Parser exacto de origen y `/attendance/[token]`; esquemas no web rechazados |
| Token en historial del navegador | `history.replaceState` a `/student` después de éxito/duplicado |
| Doble asistencia | Índices únicos y comprobaciones transaccionales |
| Cambio de cuenta en el mismo navegador | Hash de confianza único y bloqueo `DEVICE_BOUND_TO_OTHER_ACCOUNT` |
| Cuenta en navegador nuevo | Bloqueo `ACCOUNT_DEVICE_MISMATCH` hasta reset docente auditado |
| Eliminación de evidencia | Anulación lógica, índices parciales e historial de auditoría |
| Corrección docente silenciosa | Razón obligatoria, RPC atómica e historial append-only |
| Override cruzado o sobre una relación ajena | Ownership docente y relación clase–sesión–matrícula en API, RPC y trigger |
| Enumeración en recuperación | Respuesta genérica exista o no la cuenta |
| Homónimos | Unicidad por `student_user_id`, no por nombre |
| Pérdida de historial | FK de asistencia `on delete set null` |
| Seguimiento geográfico | GPS opcional; no se guardan IP, cookie cruda ni coordenadas exactas del alumno |

## Privacidad de proyección

El proyector es una página protegida separada y muestra únicamente asignatura, QR, contador, nombre, hora e indicador de éxito. No recibe correo, GPS, red, revisión, notas, motivo manual ni datos de dispositivo.

## Recuperación de contraseña

Alta, inicio y vinculación de navegador usan correo+contraseña sin OTP. El correo solo interviene en `resetPasswordForEmail`: se valida el dominio, siempre se responde con texto genérico, se exige una sesión Recovery válida para `updateUser`, y después se cierra sesión. Cambiar contraseña no altera rol, allowlist, nombre ni dispositivo de confianza.

## Controles de base de datos

`institutional_accounts` solo permite SELECT de la fila propia a `authenticated`. `student_profiles` limita lectura/edición a la fila propia y concede UPDATE únicamente sobre `display_name`. `teacher_allowlist` no tiene acceso de cliente. Las políticas docentes existentes y el trigger que exige `teacher_id` permanecen activos.

## Recomendaciones operativas

Antes de un despliegue real, configura rate limiting distribuido, observabilidad, copias de seguridad, rotación de secretos y un proceso formal de administración de la allowlist. Valida primero cada migración en un entorno aislado y realiza QA física en los navegadores objetivo.
