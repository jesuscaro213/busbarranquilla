# Spec 03 — route:report_resolved Socket Event

## Contexto del código actual

En `trip_notifier.dart`, `_bindSocketRouteListeners()` solo maneja:
```dart
socket.on('route:new_report', (_) => unawaited(_reloadReports()));
socket.on('route:report_confirmed', (_) => unawaited(_reloadReports()));
```

No hay `route:report_resolved`. Tampoco se limpia en `endTrip()`.

## Backend

`PATCH /api/reports/:id/resolve` emite a la sala `route:{id}`:
```json
{ "reportId": 42, "type": "trancon", "duration_minutes": 15 }
```

---

## Step 1 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const tranconResolvedWithDuration = 'Trancón resuelto — duró ~';
static const tranconResolvedMinutes = ' min';
static const tranconResolved = 'El trancón en esta ruta fue resuelto';
static const tranconResolvedWaiting = '✅ El trancón en esta ruta se resolvió';
```

---

## Step 2 — TripNotifier: agregar route:report_resolved

**Archivo:** `lib/features/trip/providers/trip_notifier.dart`

### 2a — Agregar callback para toasts

En la clase `TripNotifier`, agregar campo:
```dart
void Function(String message)? _onReportResolved;

void setReportResolvedCallback(void Function(String message) cb) {
  _onReportResolved = cb;
}
```

### 2b — Actualizar _bindSocketRouteListeners

Reemplazar el método completo:

```dart
void _bindSocketRouteListeners(int routeId) {
  final socket = ref.read(socketServiceProvider);
  socket.off('route:new_report');
  socket.off('route:report_confirmed');
  socket.off('route:report_resolved');

  socket.on('route:new_report', (_) => unawaited(_reloadReports()));
  socket.on('route:report_confirmed', (_) => unawaited(_reloadReports()));
  socket.on('route:report_resolved', (data) {
    if (data is! Map) return;

    // Remover reporte resuelto de la lista
    final reportId = (data['reportId'] as num?)?.toInt();
    if (reportId != null && state is TripActive) {
      final active = state as TripActive;
      state = active.copyWith(
        reports: active.reports
            .where((r) => r.id != reportId)
            .toList(growable: false),
      );
    }

    // Toast si es trancón
    final type = data['type'] as String? ?? '';
    if (type == 'trancon') {
      final mins = (data['duration_minutes'] as num?)?.toInt() ?? 0;
      final msg = mins > 0
          ? '${AppStrings.tranconResolvedWithDuration}$mins${AppStrings.tranconResolvedMinutes}'
          : AppStrings.tranconResolved;
      _onReportResolved?.call(msg);
    }
  });
}
```

### 2c — Limpiar en endTrip()

En el método `endTrip()` (ya actualizado en spec 02), verificar que incluye:
```dart
socket.off('route:report_resolved');
```
Si spec 02 ya lo agregó, no duplicar.

---

## Step 3 — ActiveTripScreen: registrar callback para toast

**Archivo:** `lib/features/trip/screens/active_trip_screen.dart`

En `initState()`, después del código existente:

```dart
@override
void initState() {
  super.initState();
  _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
    if (mounted) setState(() {});
  });

  // Registrar callback para notificaciones de trancón resuelto
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted) return;
    ref.read(tripNotifierProvider.notifier).setReportResolvedCallback((msg) {
      if (mounted) AppSnackbar.show(context, msg);
    });
  });
}
```

Agregar import si no está:
```dart
import '../../../shared/widgets/app_snackbar.dart';
```

**Nota:** Revisar la firma de `AppSnackbar.show()` en `lib/shared/widgets/app_snackbar.dart`.
Si requiere un segundo parámetro `SnackbarType`, usar `SnackbarType.info` o el tipo que corresponda.

---

## Step 4 — BoardingConfirmScreen: socket mientras espera el bus

**Archivo:** `lib/features/trip/screens/boarding_confirm_screen.dart`

El usuario ve esta pantalla mientras espera el bus (antes de "Me subí").
Agregar socket para notificar si el trancón en esa ruta se resuelve.

### 4a — Agregar imports

```dart
import '../../../core/socket/socket_service.dart';
import '../../../core/l10n/strings.dart';
import '../../../shared/widgets/app_snackbar.dart';
```

### 4b — Agregar join en initState()

Al final de `initState()`:
```dart
WidgetsBinding.instance.addPostFrameCallback((_) {
  if (!mounted) return;
  ref.read(socketServiceProvider).joinRoute(widget.routeId);
  ref.read(socketServiceProvider).on('route:report_resolved', _onRouteReportResolved);
});
```

### 4c — Agregar handler

```dart
void _onRouteReportResolved(dynamic data) {
  if (data is! Map || !mounted) return;
  final type = data['type'] as String? ?? '';
  if (type != 'trancon') return;
  final mins = (data['duration_minutes'] as num?)?.toInt() ?? 0;
  final msg = mins > 0
      ? '${AppStrings.tranconResolvedWithDuration}$mins${AppStrings.tranconResolvedMinutes}'
      : AppStrings.tranconResolvedWaiting;
  AppSnackbar.show(context, msg);
}
```

### 4d — Limpiar en dispose()

```dart
@override
void dispose() {
  ref.read(socketServiceProvider).leaveRoute(widget.routeId);
  ref.read(socketServiceProvider).off('route:report_resolved');
  super.dispose();
}
```

**Nota:** `BoardingConfirmScreen` ya recibe `routeId` como parámetro del widget (`widget.routeId`), úsalo directamente.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: route:report_resolved socket — toast en viaje activo y en espera`
