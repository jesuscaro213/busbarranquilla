# Spec 26 — Boarding Distance Warning (>800 m from Route)

## Problem
The web warns the user before confirming boarding if they are more than 800 m from the route
geometry. It shows a confirmation dialog: "Pareces estar lejos de esta ruta (X m). ¿Seguro que
quieres subir?". The user can confirm anyway (`forceStart = true`) or cancel. Flutter has no such
check — users can accidentally board the wrong route.

## Goal
In `BoardingConfirmScreen`, before calling `startTrip()`, compute the minimum distance from the
user's current position to the route geometry (polyline). If the distance exceeds 800 m, show a
confirmation dialog instead of starting immediately.

---

## Files to modify

### 1. `flutter_app/lib/features/trip/screens/boarding_confirm_screen.dart`

#### 1a. Add a `_boardingDistanceWarning` state field

```dart
int? _boardingDistanceWarning;  // metres; non-null when warning is pending
```

#### 1b. Add geometry distance helper (static method inside the State class)

```dart
/// Minimum perpendicular distance in metres from [userLat,userLng] to [geometry].
/// Returns null if geometry has fewer than 2 points.
static double? _minDistToGeometry(
  double userLat, double userLng, List<LatLng> geometry,
) {
  if (geometry.length < 2) return null;
  double minDist = double.infinity;
  for (int i = 0; i < geometry.length - 1; i++) {
    final d = _distToSegmentMeters(
      userLat, userLng,
      geometry[i].latitude, geometry[i].longitude,
      geometry[i + 1].latitude, geometry[i + 1].longitude,
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/// Perpendicular distance from point P to segment A→B (in metres, approximate).
static double _distToSegmentMeters(
  double pLat, double pLng,
  double aLat, double aLng,
  double bLat, double bLng,
) {
  import 'dart:math' as math;
  final dx = bLat - aLat;
  final dy = bLng - aLng;
  final lenSq = dx * dx + dy * dy;
  if (lenSq == 0) {
    return LocationService.distanceMeters(pLat, pLng, aLat, aLng);
  }
  final t = math.max(
    0.0,
    math.min(1.0, ((pLat - aLat) * dx + (pLng - aLng) * dy) / lenSq),
  );
  return LocationService.distanceMeters(
    pLat, pLng, aLat + t * dx, aLng + t * dy,
  );
}
```

> **Note:** Move the `import 'dart:math' as math;` to the top of the file, not inside the method.

#### 1c. Replace `_confirm()` with distance-aware version

```dart
Future<void> _confirm({bool force = false}) async {
  if (!force && _userPosition != null && _route != null) {
    final dist = _minDistToGeometry(
      _userPosition!.latitude,
      _userPosition!.longitude,
      _route!.geometry,
    );
    if (dist != null && dist > 800) {
      setState(() => _boardingDistanceWarning = dist.round());
      return;
    }
  }

  setState(() => _boardingDistanceWarning = null);

  await ref.read(tripNotifierProvider.notifier).startTrip(
    widget.routeId,
    destinationStopId: _selectedStopId,
  );
  if (!mounted) return;
  final tripState = ref.read(tripNotifierProvider);
  if (tripState is TripActive) {
    context.go('/trip');
  } else if (tripState is TripError) {
    AppSnackbar.show(context, tripState.message, SnackbarType.error);
  }
}
```

#### 1d. Show warning dialog when `_boardingDistanceWarning` is set

In `build()`, listen for the warning state with a `ref.listen` OR handle it in the build tree. The
simplest approach: trigger a dialog via `WidgetsBinding.addPostFrameCallback` when
`_boardingDistanceWarning` becomes non-null.

Add inside `build()`, before the `return Scaffold(...)`:

```dart
if (_boardingDistanceWarning != null) {
  WidgetsBinding.instance.addPostFrameCallback((_) => _showDistanceWarning());
}
```

Add the dialog method:

```dart
void _showDistanceWarning() {
  final dist = _boardingDistanceWarning;
  if (dist == null) return;
  showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text(AppStrings.boardingDistanceTitle),
      content: Text('${AppStrings.boardingDistanceBody} $dist m.'),
      actions: <Widget>[
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            setState(() => _boardingDistanceWarning = null);
          },
          child: const Text(AppStrings.cancel),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            setState(() => _boardingDistanceWarning = null);
            _confirm(force: true);
          },
          child: const Text(AppStrings.boardingDistanceConfirm),
        ),
      ],
    ),
  );
}
```

#### 1e. Update the existing board button `onPressed` to call `_confirm()`

Find the FilledButton / AppButton that calls `_confirm()` and ensure it calls `_confirm()` without
arguments (the default `force: false`).

### 2. `flutter_app/lib/core/l10n/strings.dart`

Add:

```dart
static const String boardingDistanceTitle = 'Estás lejos de esta ruta';
static const String boardingDistanceBody =
    'Pareces estar a más de 800 m de la ruta. ¿Seguro que quieres subir?';
static const String boardingDistanceConfirm = 'Sí, subir igual';
static const String cancel = 'Cancelar';
```

> **Note:** Check if `cancel` already exists in `strings.dart`. If so, skip adding it.

---

## Acceptance criteria
- If user position is known and geometry has ≥2 points AND distance >800 m: dialog is shown before
  boarding.
- User can confirm ("Sí, subir igual") to proceed despite the distance.
- User can cancel to stay on the boarding confirm screen.
- If geometry is empty or user position is unknown: boarding proceeds without the check.
- `flutter analyze` reports 0 new issues.
