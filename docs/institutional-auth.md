# Autenticación institucional — v1.0.0

## Modelo

Todas las personas crean una cuenta e inician sesión con contraseña usando uno de dos dominios exactos: `students.example.edu` para estudiantes y `faculty.example.edu` para docentes. El servidor normaliza el correo con `trim` y minúsculas antes de contactar Supabase Auth. No se aceptan otros subdominios, dominios parecidos ni proveedores externos. La contraseña debe tener al menos ocho caracteres.

Después de que Supabase autentica la contraseña, el backend consulta `teacher_allowlist`:

```text
correo institucional autenticado
  → @students.example.edu: student
  → @faculty.example.edu + allowlist activa: teacher
  → @faculty.example.edu sin allowlist activa: acceso denegado
  → upsert institutional_accounts
  → creación idempotente del perfil correspondiente
```

La interfaz nunca pregunta el rol. `institutional_accounts` no concede INSERT ni UPDATE a `authenticated`, y `teacher_allowlist` no concede acceso a `anon` ni `authenticated`.

## Configuración manual en Supabase

No automatices estos cambios desde la aplicación.

1. Abre **Supabase Dashboard → proyecto → Authentication → URL Configuration**.
2. Abre **Authentication → Providers → Email** y mantén habilitados el proveedor y el alta de usuarios.
3. Desactiva **Confirm email** si quieres que el endpoint `/api/auth/sign-up` cree una sesión inmediata. Si permanece activo, adapta el flujo de alta antes de desplegar.
4. Conserva la Site URL y Redirect URLs correctas para cualquier enlace heredado, aunque el flujo activo no depende del correo electrónico.
5. Las cuentas heredadas creadas solo mediante OTP pueden no disponer de una contraseña conocida: asígnales una contraseña de forma administrativa antes de probar el acceso.

La ruta `/auth/confirm` se conserva únicamente para enlaces heredados de v0.4. El flujo activo usa `/api/auth/sign-up` y `/api/auth/sign-in`; no solicita ni verifica códigos OTP.

## Allowlist docente

Después de aplicar las migraciones, añade correos docentes mediante SQL Editor o una herramienta administrativa con privilegios de service role:

```sql
insert into public.teacher_allowlist (email, active)
values ('docente.qa@faculty.example.edu', true)
on conflict (email) do update set active = excluded.active;
```

Usa únicamente direcciones autorizadas y no guardes cuentas reales en Git. Desactivar `active` revoca el acceso docente en la siguiente comprobación. Nunca convierte una cuenta `@faculty.example.edu` en estudiante.

## Secuencia de validación

1. Crear cuenta con minúsculas y mayúsculas; comprobar normalización.
2. Rechazar Gmail, subdominio y dominio parecido antes de contactar Auth.
3. Iniciar sesión con contraseña válida y confirmar cookies SSR.
4. Cerrar/reabrir el navegador con sesión válida; no debe pedir la contraseña de nuevo.
5. Cuenta `@students.example.edu` → `/student`.
6. Cuenta `@faculty.example.edu` activa en allowlist → `/teacher`; sin allowlist → acceso denegado.
7. Estudiante abre `/teacher` o llama una API docente → redirección/403 sin datos.
8. Estudiante edita únicamente su nombre; correo y rol permanecen inmutables.
9. Persona sin sesión escanea QR → mensaje de inicio de sesión; tras autenticar vuelve a `/student` y debe escanear un QR nuevo.
10. Verificar contraseña incorrecta, contraseña corta, confirmación distinta, fallo de red y fallo de bootstrap sin mostrar detalles internos.

## Persistencia y cierre de sesión

`@supabase/ssr` conserva y renueva la sesión mediante cookies. La aplicación no guarda access tokens ni refresh tokens manualmente en `localStorage`. Cerrar sesión llama `Supabase Auth signOut`, redirige a `/login` y no borra perfiles ni historial de asistencia.

La recuperación de contraseña utiliza el flujo Recovery de Supabase, una cookie SSR temporal y cierre de sesión obligatorio después del cambio.
