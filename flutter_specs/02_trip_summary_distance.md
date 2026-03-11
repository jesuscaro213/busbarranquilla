# Spec 02 — Trip Summary: Distancia + Bonus Completación

## Problema actual

En `active_trip_screen.dart` líneas ~244-260, el summary se muestra con datos ANTES de que la API responda:
```dart
final credits = active.trip.creditsEarned;  // ← créditos pendientes, no finales
await ref.read(tripNotifierProvider.notifier).endTrip();
// ... muestra TripSummarySheet con `credits` viejo
```

Además `TripSummarySheet` no muestra distancia ni bonus de completación.

## Cambios requeridos

---

## Step 1 — Modelo TripEndResult

**Archivo nuevo:** `lib/core/domain/models/trip_end_result.dart`

```dart
import 'active_trip.dart';
import 'model_parsers.dart';

class TripEndResult {
  final ActiveTrip trip;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;

  const TripEndResult({
    required this.trip,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
  });

  factory TripEndResult.fromJson(Map<String, dynamic> json) {
    return TripEndResult(
      trip: ActiveTrip.fromJson(mapAt(json, 'trip')),
      totalCreditsEarned: asInt(json['totalCreditsEarned']),
      distanceMeters: asInt(json['distance_meters']),
      completionBonusEarned: asBool(json['completion_bonus_earned']),
    );
  }
}
```

Agregar export en `lib/core/domain/models/index.dart`:
```dart
export 'trip_end_result.dart';
```

---

## Step 2 — TripsRepository: retornar TripEndResult

**Archivo:** `lib/core/data/repositories/trips_repository.dart`

Cambiar el tipo de retorno de `end()`:

```dart
// ANTES:
Future<Result<ActiveTrip>> end({Map<String, dynamic>? body}) async {
  try {
    final data = await _source.end(body: body);
    final trip = ActiveTrip.fromJson(mapAt(data, 'trip'));
    return Success<ActiveTrip>(trip);
  } on DioException catch (e) {
    return Failure<ActiveTrip>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<ActiveTrip>(UnknownError());
  }
}

// DESPUÉS:
Future<Result<TripEndResult>> end({Map<String, dynamic>? body}) async {
  try {
    final data = await _source.end(body: body);
    return Success<TripEndResult>(TripEndResult.fromJson(data));
  } on DioException catch (e) {
    return Failure<TripEndResult>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<TripEndResult>(UnknownError());
  }
}
```

Agregar import:
```dart
import '../models/trip_end_result.dart';
```

---

## Step 3 — TripState: agregar TripEnded

**Archivo:** `lib/features/trip/providers/trip_state.dart`

Agregar al final del archivo:

```dart
final class TripEnded extends TripState {
  final String routeName;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final Duration tripDuration;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
  });
}
```

---

## Step 4 — TripNotifier.endTrip(): transicionar a TripEnded

**Archivo:** `lib/features/trip/providers/trip_notifier.dart`

Reemplazar el método `endTrip()` completo:

```dart
Future<void> endTrip() async {
  if (state is! TripActive) {
    state = const TripIdle();
    return;
  }

  final active = state as TripActive;
  final startedAt = active.trip.startedAt;
  final routeName = active.route.name;
  final duration = startedAt != null
      ? DateTime.now().difference(startedAt)
      : Duration.zero;

  _disposeMonitorsAndTimers();
  final socket = ref.read(socketServiceProvider);
  if (active.trip.routeId != null) {
    socket.leaveRoute(active.trip.routeId!);
  }
  socket.off('route:new_report');
  socket.off('route:report_confirmed');
  socket.off('route:report_resolved');

  final result = await ref.read(tripsRepositoryProvider).end();

  switch (result) {
    case Success<TripEndResult>(data: final data):
      state = TripEnded(
        routeName: routeName,
        totalCreditsEarned: data.totalCreditsEarned,
        distanceMeters: data.distanceMeters,
        completionBonusEarned: data.completionBonusEarned,
        tripDuration: duration,
      );
    case Failure<TripEndResult>():
      state = const TripIdle();
  }
}

void resetToIdle() {
  state = const TripIdle();
}
```

Agregar import:
```dart
import '../../../core/domain/models/trip_end_result.dart';
```

---

## Step 5 — Strings

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:
```dart
static const tripDistanceLabel = 'Distancia';
static const tripCompletionBonus = '+5 créditos por completar el viaje';
static const tripShortDistance = 'Recorriste menos de 2 km — no se otorgó el bonus de completación';
static const tripKmSuffix = 'km';
static const tripMetersSuffix = 'm';
```

---

## Step 6 — TripSummarySheet: agregar distancia y bonus

**Archivo:** `lib/features/trip/widgets/trip_summary_sheet.dart`

Reemplazar la implementación completa:

```dart
import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';

class TripSummarySheet extends StatelessWidget {
  final String routeName;
  final String durationText;
  final int creditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final VoidCallback onClose;

  const TripSummarySheet({
    required this.routeName,
    required this.durationText,
    required this.creditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.onClose,
    super.key,
  });

  String get _distanceText {
    if (distanceMeters >= 1000) {
      return '${(distanceMeters / 1000).toStringAsFixed(1)} ${AppStrings.tripKmSuffix}';
    }
    return '$distanceMeters ${AppStrings.tripMetersSuffix}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(routeName, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _Row(label: AppStrings.tripDurationLabel, value: durationText),
        const SizedBox(height: 6),
        _Row(label: AppStrings.tripDistanceLabel, value: _distanceText),
        const SizedBox(height: 6),
        _Row(
          label: AppStrings.tripCreditsLabel,
          value: '+$creditsEarned',
          valueColor: AppColors.success,
        ),
        if (completionBonusEarned) ...<Widget>[
          const SizedBox(height: 4),
          const Text(
            AppStrings.tripCompletionBonus,
            style: TextStyle(color: AppColors.success, fontSize: 12),
          ),
        ],
        if (!completionBonusEarned && distanceMeters < 2000) ...<Widget>[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.amber.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.amber.shade300),
            ),
            child: const Text(
              AppStrings.tripShortDistance,
              style: TextStyle(fontSize: 12),
            ),
          ),
        ],
        const SizedBox(height: 16),
        AppButton.primary(label: AppStrings.tripClose, onPressed: onClose),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _Row({required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Text(label),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: valueColor,
          ),
        ),
      ],
    );
  }
}
```

---

## Step 7 — ActiveTripScreen: usar TripEnded para mostrar summary

**Archivo:** `lib/features/trip/screens/active_trip_screen.dart`

### 7a — Agregar manejo de TripEnded en build()

En el método `build()`, ANTES del bloque `if (state is TripIdle)`, agregar:

```dart
if (state is TripEnded) {
  final ended = state as TripEnded;
  final h = ended.tripDuration.inHours.toString().padLeft(2, '0');
  final m = (ended.tripDuration.inMinutes % 60).toString().padLeft(2, '0');
  final durationText = '$h:$m';

  return Scaffold(
    appBar: AppBar(title: const Text(AppStrings.tripSummaryTitle)),
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: TripSummarySheet(
          routeName: ended.routeName,
          durationText: durationText,
          creditsEarned: ended.totalCreditsEarned,
          distanceMeters: ended.distanceMeters,
          completionBonusEarned: ended.completionBonusEarned,
          onClose: () {
            ref.read(tripNotifierProvider.notifier).resetToIdle();
            if (mounted) context.go('/map');
          },
        ),
      ),
    ),
  );
}
```

### 7b — Simplificar el botón "Me bajé"

El botón actual llama `endTrip()` y luego muestra un `AppBottomSheet` con datos viejos.
Reemplazarlo para que solo llame `endTrip()` — el estado `TripEnded` se encarga de mostrar el summary:

```dart
// ANTES (líneas ~244-265):
AppButton.destructive(
  label: AppStrings.tripEndButton,
  onPressed: () async {
    final routeName = active.route.name;
    final credits = active.trip.creditsEarned;
    final duration = _durationText(_duration);

    await ref.read(tripNotifierProvider.notifier).endTrip();

    if (!context.mounted) return;
    await AppBottomSheet.show<void>(
      context,
      title: AppStrings.tripSummaryTitle,
      child: TripSummarySheet(
        routeName: routeName,
        durationText: duration,
        creditsEarned: credits,
        onClose: () => Navigator.of(context).pop(),
      ),
    );
    if (mounted) context.go('/map');
  },
),

// DESPUÉS (simple):
AppButton.destructive(
  label: AppStrings.tripEndButton,
  onPressed: () => ref.read(tripNotifierProvider.notifier).endTrip(),
),
```

### 7c — Eliminar imports no usados

Si `AppBottomSheet` ya no se usa en este archivo después del cambio, eliminar su import.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: trip summary with distance and completion bonus from API response`
