# Recuperación de contraseña — v1.0.0

## Hosted Supabase Auth configuration

The application recovery flow is:

1. POST `/api/auth/forgot-password`
2. Supabase Auth sends the Recovery email through the project's existing custom SMTP.
3. The email links to `/auth/confirm?token_hash=...&type=recovery`.
4. The server verifies the token hash and redirects to `/reset-password`.
5. The user sets a new password, is signed out, and returns to normal login.

### Configuración de URL

Usa el origen de tu entorno de pruebas, por ejemplo:

- Site URL: `https://attendance-preview.example`
- Redirect URL: `https://attendance-preview.example/reset-password`
- Redirect URL: `https://attendance-preview.example/auth/confirm`

Antes de publicar, añade las URL equivalentes del dominio real. `https://attendance.example.edu` es solo un ejemplo reservado.

### Recovery email

Subject:

`Restablece tu contraseña · Campus Attendance`

The canonical HTML source is:

`supabase/templates/recovery.html`

Copy that HTML into Supabase Dashboard → Authentication → Email Templates → Recovery.

The template intentionally uses:

`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

so the SSR flow exchanges the token on the server and never exposes a recovery token in the final reset-password URL.

### SMTP

Keep the existing custom SMTP credentials and authenticated sender address.

Recommended sender name:

`Sistema de Asistencia · Campus Attendance`

Do not commit SMTP host credentials, username, password, API keys, or sender secrets.

## Security behavior

The forgot-password endpoint always returns the same public success message for an unknown account or provider delivery failure, preventing account enumeration.

Provider failures are logged server-side with only:

- error name
- provider error code
- HTTP/status code

The submitted email, provider message, tokens, SMTP credentials, and recovery link are never logged.

## Lista de validación

- Request recovery for a real student account.
- Confirm exactly one recovery email arrives.
- Confirm sender name and institutional template.
- Open the email link.
- Confirm the browser lands on `/reset-password` without token parameters.
- Set a valid new password.
- Confirm the recovery session is signed out.
- Confirm old password no longer authenticates.
- Confirm new password authenticates normally.
- Request a link for an unknown institutional account and verify the UI response is indistinguishable.
- Verify an expired/used recovery link shows the expired-link state.
