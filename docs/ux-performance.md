# UX y rendimiento — v1.0.0

## Auditoría visual

La interfaz pública utiliza un sistema visual propio y neutral. No incorpora logos, tipografías, hojas de estilo ni recursos de una universidad concreta.

- Tipografía confirmada: Inter, con Arial y `sans-serif` como respaldo.
- Cuerpo: 16 px, peso 400 y párrafos con 24 px de interlineado.
- Títulos observados: 26, 24, 20 y 18 px; peso 600 en jerarquías destacadas.
- Azul principal: `#1d4ed8`.
- Azul secundario: `#2563eb`.
- Texto: `#1e293b`; texto secundario: `#64748b`.
- Bordes: `#dbe3ed`; superficies suaves: `#eff6ff`.
- Radio habitual: 4 px.
- Transiciones observadas: alrededor de 150–300 ms.

La aplicación usa `next/font/google` para Inter con subconjunto latino y `display: swap`; Next.js aloja y optimiza la fuente durante la compilación. Solo se usa la familia variable, sin descargar variantes separadas innecesarias.

## Sistema de interfaz

Los botones comparten cuatro niveles: primario, secundario, peligro y discreto. Las acciones usan sentence case y los enlaces se reservan para navegación. QR y CSV conservan mayúsculas por significado.

Confirmaciones, notas, moderación, anulación, archivo, baja de matrícula, restablecimiento de dispositivo, detalle de celda y edición de sesión comparten `InstitutionalDialog`. El componente usa portal, foco inicial, trampa Tab/Shift+Tab, Escape seguro, restauración de foco y estados pending/error internos; no quedan diálogos nativos del navegador.

El encabezado mantiene navegación por rol, estado activo, identidad truncada y menú móvil controlable con teclado. El nombre y correo aparecen antes del avatar en el orden del DOM; todo el bloque continúa siendo el mismo enlace de perfil. El pie identifica el proyecto sin enlaces ni atribuciones externas.

## Estados de carga

- `InstitutionalRouteSkeleton` mantiene una cabecera estable y evita pantallas blancas durante transiciones autenticadas.
- `InstitutionalLoader` sirve para lecturas locales, como el catálogo de asignaturas.
- `InstitutionalMutationOverlay` se reserva para mutaciones relevantes y expone `role="status"`, `aria-live="polite"` y `aria-busy`.
- `PendingButtonLabel` confirma el clic en el control que inició la operación.
- Cada mutación usa `finally` para limpiar el estado incluso después de un error.
- Los controles que mutan permanecen deshabilitados mientras la petición está activa para evitar duplicados.
- `prefers-reduced-motion` elimina spinner, skeleton y transiciones no esenciales.

La proyección no incorpora un `loading.tsx` propio para no introducir parpadeos en el proyector.

## Rendimiento

Cuellos de botella comprobados y corregidos:

1. La vista de matrículas resolvía cada perfil con una consulta independiente. Ahora reúne los `student_user_id`, carga todos los perfiles en una única consulta y usa un mapa en memoria.
2. La identidad institucional se memoiza con `cache()` únicamente dentro de la petición de React; no existe caché global compartida entre usuarios.
3. Las rutas calientes de matrícula y proyección seleccionan columnas explícitas.
4. `qrcode` se importa de forma dinámica cuando el docente abre asistencia, no al cargar el catálogo.
5. Las lecturas independientes de resúmenes, matriz y detalle continúan paralelizadas con `Promise.all`.

La matriz sigue cargando matrículas, sesiones, asistencias y correcciones por lotes; nunca consulta una celda individualmente. Realtime conserva la fusión local y no fuerza una recarga total después de cada asistencia.

## Índices y caché

No se añaden índices de rendimiento. Los filtros actuales ya están cubiertos por los índices compuestos de clases, matrículas, sesiones, asistencia activa y correcciones introducidos en migraciones anteriores. La única migración final añade auditoría de edición de sesiones y su índice de consulta por sesión/fecha.

Los datos privados solo usan memoización por petición. La asistencia activa y Realtime no usan caché persistente.
