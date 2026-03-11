# Spec 31 — Inline Preview of Nearby Route Before Boarding

## Problem
In the web's PlanTripMode, tapping a "Buses en tu zona" card shows an inline activity/info panel
before the user commits to boarding. In Flutter's PlannerScreen, tapping a nearby route immediately
navigates to `/trip/confirm`, giving the user no chance to inspect the route first.

## Goal
Tapping a nearby route card in `PlannerScreen` should first expand an inline detail section showing
the `RouteActivityBadge`. A second tap (or a dedicated "Subir" button) navigates to
`/trip/confirm`.

---

## Files to modify

### 1. `flutter_app/lib/features/planner/screens/planner_screen.dart`

#### 1a. Add a `_selectedNearbyRouteId` state field

```dart
int? _selectedNearbyRouteId;
```

#### 1b. Replace the `InkWell.onTap` for each nearby route card

Change from immediately navigating to instead toggling the selected state:

```dart
onTap: () {
  setState(() {
    _selectedNearbyRouteId =
        _selectedNearbyRouteId == route.id ? null : route.id;
  });
},
```

#### 1c. Inside the nearby route card `Column`, add an expanded detail section

After the existing `RouteActivityBadge` row, add:

```dart
if (_selectedNearbyRouteId == route.id) ...<Widget>[
  const SizedBox(height: 10),
  const Divider(height: 1),
  const SizedBox(height: 10),
  Row(
    mainAxisAlignment: MainAxisAlignment.end,
    children: <Widget>[
      FilledButton.icon(
        onPressed: () => context.push('/trip/confirm?routeId=${route.id}'),
        icon: const Icon(Icons.directions_bus, size: 16),
        label: const Text(AppStrings.nearbyBoardButton),
      ),
    ],
  ),
],
```

#### 1d. Clear `_selectedNearbyRouteId` when nearby list changes

In `build()`, after computing `nearbyRoutes`, add:

```dart
// If the nearby list no longer contains the selected route, deselect it.
if (_selectedNearbyRouteId != null &&
    nearbyRoutes.every((r) => r.id != _selectedNearbyRouteId)) {
  // Schedule to avoid calling setState during build
  WidgetsBinding.instance.addPostFrameCallback(
    (_) => setState(() => _selectedNearbyRouteId = null),
  );
}
```

### 2. `flutter_app/lib/core/l10n/strings.dart`

Add (only if not already present):

```dart
static const String nearbyBoardButton = 'Subir a este bus';
```

---

## Acceptance criteria
- Tapping a nearby route card expands an inline panel with a "Subir a este bus" button.
- Tapping the same card again collapses the panel (toggle).
- Tapping a different card collapses the previous one and expands the new one.
- Pressing "Subir a este bus" navigates to `/trip/confirm?routeId=...`.
- `flutter analyze` reports 0 new issues.
