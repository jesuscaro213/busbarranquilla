# MiBus — Memory

Decisiones de diseño no obvias, bugs resueltos con lógica especial, y thresholds que no se deben cambiar sin revisar el contexto.

---

## Planificador — punto de bajada y legs

### El backend debe devolver el ID de la parada, no solo las coordenadas
Cuando el backend calcula `alightingStop` en `planRoute`, tiene toda la lógica de leg-filtering. Si Flutter solo recibe `nearest_stop_lat/lng` y hace su propia búsqueda local, puede elegir una parada en el leg opuesto en calles donde ida/regreso son paralelas.
**Regla:** `planRoute` siempre debe devolver `nearest_stop_id`. `BoardingConfirmScreen` lo usa directamente como `autoSelected` sin recalcular.

### El DropoffMonitor no debe disparar en coords de la parada
La parada de bajada puede estar desplazada respecto del punto donde el bus pasa más cerca del destino. El destino del usuario tampoco sirve como trigger directo — el bus nunca llega a la casa del pasajero.
**Solución correcta:** proyectar el destino sobre la geometría de la ruta usando `turnaround_idx` para filtrar el leg. Devolver `projected_lat/lng` y usarlo como synthetic stop (`id: -1`) en el monitor.

### `setDestinationByLatLngFree` vs `setDestinationByLatLng`
- `setDestinationByLatLng` — cobra 5 créditos a usuarios free. Uso: selección manual en mapa.
- `setDestinationByLatLngFree` — sin cargo. Uso: planner flow, donde el destino ya era conocido al iniciar el viaje. Si se usa `setDestinationByLatLng` en el planner se cobra dos veces (una al comprar créditos, otra aquí).

---

## Rutas — geometría y turnaround_idx

### `turnaround_idx` puede ser null
Rutas importadas o creadas antes de la Phase 3.7 pueden no tener `turnaround_idx`. Todo código que lo use debe tener fallback explícito a la geometría completa.

### `geometry` puede ser null
Rutas creadas sin OSRM disponible quedan sin geometría. El planificador tiene un path de fallback basado solo en paradas (`stop_order`). No asumir que `geometry` siempre existe.

---

## Flutter — flujo de viaje

### `ref.listen` no captura el estado inicial
`ref.listen` solo detecta *cambios*. Si el estado ya es `TripActive` cuando el widget se monta (ej. tras navegación), el listener nunca dispara. Fix estándar: leer el estado en `initState` dentro de `addPostFrameCallback`.

### DropoffMonitor usa `getLastKnownPosition` primero
`getCurrentPosition()` puede tardar o fallar con batería baja. El monitor llama `Geolocator.getLastKnownPosition()` (cache del OS, retorna en ms) y solo hace `getCurrentPosition()` si el cache es null.

### `_noDestTimer` se cancela al setear destino
El timer de 4 minutos que muestra el prompt de bajada se cancela en `setDestinationByLatLng`, `setDestinationByLatLngFree`, y `updateDestinationByLatLng`. No hace falta cancelarlo manualmente desde la UI.

---

## Backend — planRoute thresholds

| Threshold | Valor | Significado |
|---|---|---|
| `ORIGIN_THRESHOLD_KM` | 0.25 km | La ruta debe pasar a ≤250m del origen |
| `DEST_THRESHOLD_KM` | 1.0 km | La ruta debe pasar a ≤1km del destino |
| Fallback paradas sin geometría | 1.5 km | Si no hay geometría, parada de abordaje/bajada ≤1.5km |

No bajar `DEST_THRESHOLD_KM` — en Barranquilla las rutas pueden pasar a 800m de una dirección y aun así ser la opción correcta.

---

## Créditos — no recargar en flujos internos

El costo de alertas de bajada es **5 créditos** y se cobra **una sola vez** por viaje. Si el usuario inicia desde el planner con destino pre-seleccionado, el destino se setea con `setDestinationByLatLngFree`. Solo se cobra cuando el usuario activa manualmente (FAB, `activateDropoffAlerts`).

---

## Convenciones

- Synthetic stop: `Stop(id: -1, ...)` — indica destino libre sin parada real. Se usa en monitor, no se persiste como `destinationStopId`.
- `pickedDestLat/pickedDestLng` en `TripActive` — coords del flag verde en el mapa. Para flujo planner: contiene el punto proyectado (dónde bajarse), no el destino final del usuario.

---

## Backend — columna `address` en stops NO existe

La tabla `stops` **no tiene** columna `address`. En algún punto se intentó agregar pero se descartó. No volver a referenciarla en ningún SELECT. `nearest_stop_address` en el response del planificador se devuelve como `null` hardcodeado.

---

## Flutter — PlannerNotifier: flag `_disposed` obligatorio

`planRoute()` hace varios `await` en secuencia. Si el usuario navega hacia atrás durante la búsqueda, el Notifier puede intentar setear `state` sobre un elemento ya desmontado → crash `_lifecycleState != defunct`.

Patrón correcto:
```dart
bool _disposed = false;

@override
PlannerState build() {
  _disposed = false;
  ref.onDispose(() => _disposed = true);
  return const PlannerIdle();
}

// Antes de cualquier state = ... tras un await:
if (_disposed) return;
```

---

## Flutter — destino del planner persiste con lastSelectedDestProvider

`plannerNotifierProvider` es auto-disposed al navegar fuera del tab Planner (MainShell usa `widget.child`, no IndexedStack). Leer `.selectedDest` del notifier desde `BoardingScreen` o `MapScreen` devuelve `null` porque el notifier ya fue destruido.

**Solución:** `lastSelectedDestProvider = StateProvider<NominatimResult?>((ref) => null)` en `planner_notifier.dart`. No auto-disposed. `setDestination()` escribe aquí además del estado interno. Cualquier pantalla que necesite el destino del planner para construir `destParam` debe leer `lastSelectedDestProvider`, no el notifier.

---

## Backend — multer versión correcta

`multer@^2.1.1` no existe en npm. Versión correcta: `^1.4.5-lts.1` + `@types/multer@^1.4.12`. Con multer v1 no se anotan tipos explícitos en `fileFilter` — se infieren solos. Si Docker no recoge cambios en `package.json` tras `--build`, correr `docker-compose down -v` para eliminar el anonymous volume `/app/node_modules`.
