# Geolocalización — v1.0.0

## Flujo activo

El GPS se solicita al estudiante en segundo plano como evidencia opcional únicamente después de que la cámara esté activa. Así se evita competir con el permiso de cámara en Android. El escaneo no espera la ubicación. La profesora puede activar una ubicación de referencia al abrir la sesión; por defecto está desactivada. `/api/attendance/scan` acepta un objeto `location` opcional.

```text
gps_status = not_shared | shared | verified | outside | inaccurate | unavailable
location_verified
location_accuracy
distance_from_center_m
```

Permiso denegado, timeout, indisponibilidad, imprecisión o posición fuera del radio no rechazan la asistencia. Sin referencia, una lectura válida queda como `shared`. Nunca se persisten latitud/longitud exactas del alumno.

## Ubicación aproximada de red

Cuando Vercel aporta sus cabeceras geográficas, el servidor puede guardar ciudad, región, país y código de país de forma aproximada. Esta señal es exclusivamente informativa:

- no se guarda la dirección IP;
- no se envía al cliente como prueba de presencia;
- una VPN, Private Relay, discrepancia de país o ausencia de cabeceras nunca bloquea asistencia;
- solo se muestra en el panel docente privado, no en modo proyección.

## Privacidad

El flujo rápido no persiste coordenadas exactas, IP, cookie cruda, `user-agent` ni huella física. La precisión y distancia derivada sí pueden conservarse como evidencia privada. La cookie firmada se transforma en hashes HMAC antes de llegar a PostgreSQL.

## Evaluación Haversine

El código anterior conserva una implementación testeada de Haversine y esta regla estricta:

```text
accuracy >= 0
accuracy <= min(MAX_LOCATION_ACCURACY_M = 50, allowedRadius / 2)
distanceFromCenter + accuracy <= allowedRadius
```

La misma función se usa ahora para clasificar evidencia como `verified`, `outside` o `inaccurate`; su resultado no autoriza ni rechaza la asistencia.

## QA pendiente

La QA física debe confirmar que Safari iOS, Chrome iOS y Chrome Android solicitan primero la cámara tras el toque explícito, que el GPS aparece después y que denegarlo no impide registrar asistencia.
