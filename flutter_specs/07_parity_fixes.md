# Spec 07 — Correcciones de Paridad

Dos valores en el código Flutter no coinciden con el backend y la web.

---

## Fix 1 — Auto-resolve trancón: 200 m → 1000 m

### Problema

`AutoResolveMonitor` auto-resuelve un reporte de trancón cuando el bus se aleja > **200 m** del reporte.
El backend y la web usan **1000 m** (1 km).

### Archivo

`lib/features/trip/monitors/auto_resolve_monitor.dart`

### Cambio

```dart
// ANTES:
if (meters > 200) {

// DESPUÉS:
if (meters > 1000) {
```

Solo cambiar ese número. Nada más.

---

## Fix 2 — Radio "Cerca de ti" en boarding: 500 m → 300 m

### Problema

`BoardingScreen._loadRoutes()` busca rutas cercanas con `radius: 0.5` (500 m).
La web usa **300 m** (`radius=0.3`) para ambas secciones "Cerca de ti".

### Archivo

`lib/features/trip/screens/boarding_screen.dart`

### Cambio

```dart
// ANTES:
final nearbyResult = await ref.read(routesRepositoryProvider).nearby(
  lat: position.latitude,
  lng: position.longitude,
  radius: 0.5,
);

// DESPUÉS:
final nearbyResult = await ref.read(routesRepositoryProvider).nearby(
  lat: position.latitude,
  lng: position.longitude,
  radius: 0.3,
);
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `fix: auto-resolve threshold 1km and nearby radius 300m`
