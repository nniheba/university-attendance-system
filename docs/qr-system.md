# Sistema QR — v1.0.0

## Un único código

Panel docente y modo proyección muestran un único QR dinámico. El valor codificado es una URL web absoluta:

```text
<APP_ORIGIN>/attendance/<signed-token>
```

El servidor elige `APP_ORIGIN` con `NEXT_PUBLIC_APP_URL` cuando está configurado intencionadamente; en caso contrario usa el origen de la petición actual. No hay hostname de Vercel ni dominio real de producción escrito en código. `https://attendance.example.edu` es únicamente un ejemplo reservado.

La URL funciona por dos vías:

- cámara nativa, Google Lens o lector QR → abre `/attendance/[token]`;
- escáner interno → valida origen y ruta, extrae el token y llama a `/api/attendance/scan` sin navegar.

El parser solo acepta esquemas web, orígenes exactos de confianza y el pathname `/attendance/[token]` sin query ni fragmento. Rechaza orígenes/rutas distintos, `javascript:`, `data:`, `file:` y entradas malformadas. Durante QA se conserva compatibilidad explícita con el token raw heredado y con el prefijo exacto `attendance:`; ningún QR nuevo utiliza esos formatos.

## Firma y vigencia

El payload firmado incluye versión, tipo, `session_id`, `issued_at`, `expiration` y nonce aleatorio. HMAC-SHA-256 se genera exclusivamente en servidor con `QR_SIGNING_SECRET`.

- `QR_TOKEN_LIFETIME_MS = 4000`
- `QR_CLOCK_TOLERANCE_MS = 750`
- aceptación máxima efectiva: 4750 ms desde `issued_at`

La tolerancia solo absorbe jitter operativo. No amplía la vida anunciada ni cambia nonce, firma, sesión o semántica de emisión/expiración.

## Rotación sin parpadeo

Cada frame saludable conserva cuatro segundos visibles. Al terminar ese plazo se solicita el siguiente token y se genera la imagen fuera de pantalla mientras el frame anterior continúa visible. Solo después de `image.decode()`/`onload` se sustituye el estado de forma atómica.

Si falla la renovación, el frame anterior permanece visible, aparece un aviso discreto y se reintenta a los 750 ms. `Generando QR…` solo se muestra antes del primer frame. Realtime, contador, feed y burbujas no reinician la rotación.

Cerrar la sesión detiene la generación y sustituye el QR por el estado «Sesión cerrada»; el backend también rechaza cualquier token anterior.

## Cámara nativa externa

`/attendance/[token]` es un flujo soportado:

1. estudiante autenticado → registro inmediato con el endpoint atómico existente;
2. duplicado → experiencia calmada de asistencia ya registrada;
3. docente → no registra y vuelve al área docente;
4. token inválido/expirado, sesión cerrada, matrícula inactiva o dispositivo en conflicto → mensaje canónico sin inserción;
5. sin sesión Auth → `/login?next=%2Fstudent%2Fscan%3Fintent%3Dattendance`.

El token expirado nunca atraviesa login/signup. Después de autenticarse, el estudiante llega a `/student/scan?intent=attendance`, recibe contexto para volver a escanear y activa la cámara con un gesto explícito. Tras éxito o duplicado, la vista reemplaza la URL con `/student` para retirar el token del historial visible sin romper la experiencia actual.

## Escáner integrado

`/student/scan` verifica primero el navegador de confianza y espera un toque en **Activar cámara**. La primera llamada a `getUserMedia()` permanece ligada al gesto; `Permissions-Policy` permite `camera=(self)` y mantiene `microphone=()`.

La decodificación se limita aproximadamente a 12 intentos por segundo. Zoom de hardware tiene prioridad y el fallback digital ajusta tanto el recorte efectivo como la vista previa. Cuando reconoce la URL única, bloquea nuevas detecciones y envía únicamente el token extraído al endpoint existente. GPS continúa siendo evidencia opcional y las coordenadas exactas no se persisten.

## Privacidad y logs

No se muestran ni registran tokens, URLs completas de asistencia, cookies, credenciales Auth o secretos. La proyección expone solo la imagen QR; la página de éxito reutiliza `AttendanceSuccessExperience` y no conserva el token en su URL final.
