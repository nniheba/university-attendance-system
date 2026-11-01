# Confirmación de correo heredada

## Estado en v0.5

El alta e inicio de sesión activos usan correo y contraseña; no generan enlaces ni códigos. La ruta `/auth/confirm` permanece solo para compatibilidad con enlaces emitidos por versiones anteriores. Valida `token_hash` con Supabase, limita el destino y elimina el token de la URL final, pero la pantalla `/login` ya no presenta estados ni controles específicos de confirmación.

## Configuración heredada

No es necesaria para el flujo actual. Si QA todavía necesita aceptar enlaces antiguos, conserva temporalmente:

1. Abre **Authentication → URL Configuration**.
2. Añade `http://localhost:3000/**` a **Redirect URLs**.
3. Añade el patrón de Vercel Preview correspondiente a tu equipo, por ejemplo `https://*-example-team.vercel.app/**`.
4. No añadas ni cambies todavía la URL canónica de Producción. Production requerirá su propio dominio autorizado en una fase separada.
5. La plantilla histórica de **Confirm signup** con este valor:

```text
{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/teacher
```

No habilites **Confirm email** para el flujo nuevo: `/api/auth/sign-up` requiere una sesión inmediata y falla de forma segura si esa opción está activa.

## Prueba de compatibilidad opcional

1. Abre un enlace histórico vigente y confirma que nunca conserva `token_hash` en la URL final.
2. Reutiliza o deja caducar un enlace y confirma que termina en el formulario normal de `/login`.
3. Confirma que crear cuenta e iniciar sesión no llama `/auth/confirm` ni depende de correo saliente.
