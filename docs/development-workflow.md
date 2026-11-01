# Development workflow

El repositorio sigue un flujo de versiones verificables y separa explícitamente QA de Producción.

```text
feature/version branch
→ incremental commits
→ Vercel Preview
→ QA
→ Pull Request
→ main
→ version tag
→ GitHub Release
```

## Ramas

- `main`: última versión fuente aprobada en QA. No implica por sí misma autorización para desplegar a Producción.
- `feature/*`: desarrollo activo de una versión o cambio concreto.
- Las ramas históricas de versión se conservan como referencia del proyecto.

Cada rama de versión parte del `main` estable. Los cambios se realizan mediante commits incrementales y, cuando sea práctico, mensajes de estilo Conventional Commits como `feat:`, `fix:`, `docs:` o `chore:`.

## Verificación y entrega

1. Implementar y validar en la rama `feature/*`.
2. Publicar automáticamente un Vercel Preview para esa rama.
3. Ejecutar QA contra servicios y datos de QA, nunca contra Producción.
4. Abrir un Pull Request hacia `main` y revisar el diff.
5. Actualizar `main` únicamente con una versión aprobada en QA.
6. Crear un tag anotado sobre el commit estable.
7. Crear el GitHub Release correspondiente sin presentarlo como release de Producción.

## Vercel

- **Preview:** entorno de prueba por rama feature.
- **Production:** requiere aprobación explícita e independiente. No se promociona automáticamente como parte del cierre de una versión o de la actualización de `main`.

Antes de cambiar ramas por defecto o reglas Git, se debe comprobar la Production Branch configurada en Vercel para evitar despliegues involuntarios.

## Versionado

Se utiliza versionado semántico durante la fase Alpha:

- `v0.5.0`: nueva versión funcional.
- `v0.5.1`: corrección compatible sobre v0.5.
- `v0.6.0`: siguiente bloque funcional.

Los tags siempre deben apuntar al commit real y validado de la versión. Si un límite histórico no puede demostrarse con el grafo Git, no se crea el tag.
