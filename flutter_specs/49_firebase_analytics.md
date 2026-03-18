# Spec 49 — Firebase Analytics

## Problem

No hay visibilidad sobre cómo los usuarios usan la app. No se sabe cuántos usuarios inician el
flujo de boarding y cuántos terminan el viaje, ni qué variante del nudge convierte más. Sin esto
las decisiones de producto son a ciegas.

---

## File 1 — `pubspec.yaml`

Add `firebase_analytics` under dependencies:

**Old:**
```yaml
  firebase_crashlytics: ^4.1.3
  firebase_messaging: ^15.1.3
```

**New:**
```yaml
  firebase_crashlytics: ^4.1.3
  firebase_analytics: ^11.3.3
  firebase_messaging: ^15.1.3
```

---

## File 2 — `lib/core/analytics/analytics_service.dart` (create)

```dart
import 'package:firebase_analytics/firebase_analytics.dart';

class AnalyticsService {
  AnalyticsService._();

  static final _analytics = FirebaseAnalytics.instance;

  // ── Boarding funnel ──────────────────────────────────────────────────────

  static Future<void> boardingFlowStarted() =>
      _analytics.logEvent(name: 'boarding_flow_started');

  static Future<void> routeSelected(int routeId, String routeCode) =>
      _analytics.logEvent(
        name: 'route_selected',
        parameters: {'route_id': routeId, 'route_code': routeCode},
      );

  static Future<void> tripStarted(int routeId, String routeCode) =>
      _analytics.logEvent(
        name: 'trip_started',
        parameters: {'route_id': routeId, 'route_code': routeCode},
      );

  static Future<void> tripEnded({
    required int durationMinutes,
    required int creditsEarned,
    required double distanceMeters,
  }) =>
      _analytics.logEvent(
        name: 'trip_ended',
        parameters: {
          'duration_minutes': durationMinutes,
          'credits_earned': creditsEarned,
          'distance_meters': distanceMeters.round(),
        },
      );

  // ── Reports ──────────────────────────────────────────────────────────────

  static Future<void> reportCreated(String type) =>
      _analytics.logEvent(
        name: 'report_created',
        parameters: {'type': type},
      );

  // ── Destination ──────────────────────────────────────────────────────────

  /// method: 'stop_list' | 'map_pick' | 'planner'
  static Future<void> destinationSet(String method) =>
      _analytics.logEvent(
        name: 'destination_set',
        parameters: {'method': method},
      );

  static Future<void> dropoffAlertActivated() =>
      _analytics.logEvent(name: 'dropoff_alert_activated');

  // ── Planner ──────────────────────────────────────────────────────────────

  static Future<void> plannerSearched() =>
      _analytics.logEvent(name: 'planner_searched');

  // ── Monetization ─────────────────────────────────────────────────────────

  static Future<void> premiumCheckoutStarted() =>
      _analytics.logEvent(name: 'premium_checkout_started');

  // ── Nudges ───────────────────────────────────────────────────────────────

  /// variant: 'regular' | 'premium_upsell'
  static Future<void> noDestinationNudgeSent(String variant) =>
      _analytics.logEvent(
        name: 'no_destination_nudge_sent',
        parameters: {'variant': variant},
      );
}
```

---

## File 3 — `lib/features/map/screens/map_screen.dart`

Import `AnalyticsService` and fire `boardingFlowStarted` on the "Me subí" FAB.

**Old** (FAB onPressed, calls `context.go('/trip/boarding')`):
```dart
              onPressed: () {
                context.go('/trip/boarding');
              },
```

**New:**
```dart
              onPressed: () {
                unawaited(AnalyticsService.boardingFlowStarted());
                context.go('/trip/boarding');
              },
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 4 — `lib/features/trip/screens/boarding_confirm_screen.dart`

Fire `routeSelected` when the confirm screen loads (route is already known).

**Old** (in `initState`, after the first line):
```dart
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
```

**New:**
```dart
  void initState() {
    super.initState();
    unawaited(AnalyticsService.routeSelected(widget.routeId, ''));
    WidgetsBinding.instance.addPostFrameCallback((_) {
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 5 — `lib/features/trip/providers/trip_notifier.dart`

### Change A: Fire `tripStarted` at the end of `startTrip()`

In `startTrip()`, just before the final `state = TripActive(...)` assignment, add:

```dart
    unawaited(AnalyticsService.tripStarted(routeId, route.code));
```

### Change B: Fire `tripEnded` in `endTrip()`

In `endTrip()`, after `state = TripEnded(result)`, add:

```dart
    final durationMinutes = result.trip != null
        ? DateTime.now().difference(result.trip!.startedAt).inMinutes
        : 0;
    unawaited(AnalyticsService.tripEnded(
      durationMinutes: durationMinutes,
      creditsEarned: result.creditsEarned,
      distanceMeters: result.distanceMeters.toDouble(),
    ));
```

### Change C: Fire `noDestinationNudgeSent` in `_noDestTimer`

Find the two `NotificationService.showAlert` calls inside `_noDestTimer`. Add analytics before each:

**Premium upsell branch — Old:**
```dart
           unawaited(NotificationService.showAlert(
             title: AppStrings.noDestinationPremiumNudgeTitle,
             body: AppStrings.noDestinationPremiumNudgeBody,
             payload: 'no_destination',
           ));
```

**Premium upsell branch — New:**
```dart
           unawaited(AnalyticsService.noDestinationNudgeSent('premium_upsell'));
           unawaited(NotificationService.showAlert(
             title: AppStrings.noDestinationPremiumNudgeTitle,
             body: AppStrings.noDestinationPremiumNudgeBody,
             payload: 'no_destination',
           ));
```

**Regular branch — Old:**
```dart
           unawaited(NotificationService.showAlert(
             title: AppStrings.noDestinationNudgeTitle,
             body: AppStrings.noDestinationNudgeBody,
             payload: 'no_destination',
           ));
```

**Regular branch — New:**
```dart
           unawaited(AnalyticsService.noDestinationNudgeSent('regular'));
           unawaited(NotificationService.showAlert(
             title: AppStrings.noDestinationNudgeTitle,
             body: AppStrings.noDestinationNudgeBody,
             payload: 'no_destination',
           ));
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 6 — `lib/features/trip/widgets/report_create_sheet.dart`

Fire `reportCreated` when a report is successfully submitted.

Find the success path after the API call (where the sheet closes or shows a snackbar). Add:

```dart
    unawaited(AnalyticsService.reportCreated(selectedType));
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 7 — `lib/features/trip/screens/active_trip_screen.dart`

Fire `destinationSet` and `dropoffAlertActivated` when user sets a destination.

In `_pickDestinationOnMap()`, after the successful `setDestinationByLatLng` / `updateDestinationByLatLng` call (where the success snackbar is shown), add:

```dart
    unawaited(AnalyticsService.destinationSet('map_pick'));
    unawaited(AnalyticsService.dropoffAlertActivated());
```

In `_changeDestination()` (stop list path), after the successful destination call, add:

```dart
    unawaited(AnalyticsService.destinationSet('stop_list'));
    unawaited(AnalyticsService.dropoffAlertActivated());
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 8 — `lib/features/planner/screens/planner_screen.dart`

Fire `plannerSearched` when the user triggers a route search.

In `_onSearch()`, just before `plannerNotifier.planRoute()`, add:

```dart
    unawaited(AnalyticsService.plannerSearched());
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## File 9 — `lib/features/profile/widgets/premium_card.dart`

Fire `premiumCheckoutStarted` when the user taps the premium button.

In the `onTap` / `onPressed` that calls `launchUrl`, add before the launch call:

```dart
    unawaited(AnalyticsService.premiumCheckoutStarted());
```

Add import at the top of the file:
```dart
import '../../../core/analytics/analytics_service.dart';
```

---

## Verification

```bash
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Events summary

| Event | Parameters | Fired from |
|-------|-----------|-----------|
| `boarding_flow_started` | — | "Me subí" FAB |
| `route_selected` | `route_id`, `route_code` | `BoardingConfirmScreen.initState` |
| `trip_started` | `route_id`, `route_code` | `TripNotifier.startTrip()` |
| `trip_ended` | `duration_minutes`, `credits_earned`, `distance_meters` | `TripNotifier.endTrip()` |
| `report_created` | `type` | `ReportCreateSheet` success path |
| `destination_set` | `method` ('map_pick'\|'stop_list') | `ActiveTripScreen` destination flows |
| `dropoff_alert_activated` | — | `ActiveTripScreen` destination flows |
| `planner_searched` | — | `PlannerScreen._onSearch()` |
| `premium_checkout_started` | — | `PremiumCard` tap |
| `no_destination_nudge_sent` | `variant` ('regular'\|'premium_upsell') | `TripNotifier._noDestTimer` |
