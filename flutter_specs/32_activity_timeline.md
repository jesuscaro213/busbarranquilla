# Spec 32 — Full Activity Timeline in RouteActivityBadge

## Problem
The web's activity panel shows a full list of recent events (boarding, alighting, reports) with
timestamps. Flutter's `RouteActivityBadge` only shows `active_count` and `last_activity_minutes`
— the `events[]` array from `GET /api/routes/:id/activity` is never parsed or displayed.

## Goal
Parse the `events` array from the activity API response into the `RouteActivity` model and add an
expandable timeline section to `RouteActivityBadge`.

---

## Backend response reference

```json
{
  "active_count": 2,
  "last_activity_minutes": 4,
  "active_positions": [[10.97, -74.78]],
  "events": [
    { "type": "boarding", "created_at": "2025-03-11T14:30:00Z", "confirmations": 0 },
    { "type": "report",   "created_at": "2025-03-11T14:28:00Z", "confirmations": 2 }
  ]
}
```

---

## Files to modify

### 1. `flutter_app/lib/core/domain/models/route_activity.dart`

#### 1a. Add `ActivityEvent` model

```dart
class ActivityEvent {
  final String type;       // 'boarding' | 'alighting' | 'report'
  final DateTime createdAt;
  final int confirmations;

  const ActivityEvent({
    required this.type,
    required this.createdAt,
    this.confirmations = 0,
  });

  factory ActivityEvent.fromJson(Map<String, dynamic> json) {
    return ActivityEvent(
      type: (json['type'] as String?) ?? '',
      createdAt: DateTime.tryParse((json['created_at'] as String?) ?? '') ?? DateTime.now(),
      confirmations: asInt(json['confirmations']),
    );
  }
}
```

#### 1b. Add `events` field to `RouteActivity`

```dart
class RouteActivity {
  final int activeCount;
  final int? lastActivityMinutes;
  final List<LatLng> activePositions;
  final List<ActivityEvent> events;   // ADD

  const RouteActivity({
    required this.activeCount,
    this.lastActivityMinutes,
    this.activePositions = const <LatLng>[],
    this.events = const <ActivityEvent>[],   // ADD
  });

  factory RouteActivity.fromJson(Map<String, dynamic> json) {
    // ... existing activePositions parsing ...

    // ADD: parse events
    final rawEvents = json['events'];
    final events = <ActivityEvent>[];
    if (rawEvents is List) {
      for (final e in rawEvents) {
        if (e is Map<String, dynamic>) {
          events.add(ActivityEvent.fromJson(e));
        }
      }
    }

    return RouteActivity(
      activeCount: asInt(json['active_count']),
      lastActivityMinutes: asIntOrNull(json['last_activity_minutes']),
      activePositions: positions,
      events: events,   // ADD
    );
  }

  bool get hasActivity => activeCount > 0 || lastActivityMinutes != null;
}
```

### 2. `flutter_app/lib/shared/widgets/route_activity_badge.dart`

#### 2a. Add `_expanded` state field

```dart
bool _expanded = false;
```

#### 2b. Add an expand/collapse button when events are available

In `build()`, after the `Wrap` of badges, add:

```dart
if (activity.events.isNotEmpty) ...<Widget>[
  const SizedBox(height: 4),
  InkWell(
    onTap: () => setState(() => _expanded = !_expanded),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          _expanded
              ? AppStrings.activityHideTimeline
              : AppStrings.activityShowTimeline,
          style: const TextStyle(fontSize: 12, color: AppColors.primary),
        ),
        Icon(
          _expanded ? Icons.expand_less : Icons.expand_more,
          size: 14,
          color: AppColors.primary,
        ),
      ],
    ),
  ),
  if (_expanded) ...<Widget>[
    const SizedBox(height: 6),
    ...activity.events.map((event) => _EventRow(event: event)),
  ],
],
```

#### 2c. Add `_EventRow` private widget at the bottom of the file

```dart
class _EventRow extends StatelessWidget {
  final ActivityEvent event;

  const _EventRow({required this.event});

  @override
  Widget build(BuildContext context) {
    final IconData icon = switch (event.type) {
      'boarding' => Icons.arrow_circle_up_outlined,
      'alighting' => Icons.arrow_circle_down_outlined,
      'report' => Icons.warning_amber_outlined,
      _ => Icons.circle_outlined,
    };

    final String label = switch (event.type) {
      'boarding' => AppStrings.activityEventBoarding,
      'alighting' => AppStrings.activityEventAlighting,
      'report' => AppStrings.activityEventReport,
      _ => event.type,
    };

    final minutesAgo = DateTime.now().difference(event.createdAt).inMinutes;
    final timeLabel = minutesAgo < 1
        ? AppStrings.activityEventJustNow
        : '$minutesAgo ${AppStrings.activityLastSeenMin}';

    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Expanded(child: Text(label, style: const TextStyle(fontSize: 12))),
          Text(timeLabel,
              style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}
```

### 3. `flutter_app/lib/core/l10n/strings.dart`

Add (only if not already present):

```dart
static const String activityShowTimeline = 'Ver actividad reciente';
static const String activityHideTimeline = 'Ocultar actividad';
static const String activityEventBoarding = 'Subió';
static const String activityEventAlighting = 'Bajó';
static const String activityEventReport = 'Reporte';
static const String activityEventJustNow = 'ahora mismo';
```

---

## Acceptance criteria
- `RouteActivity.fromJson` parses the `events` array into `List<ActivityEvent>`.
- When `events` is non-empty, `RouteActivityBadge` shows a "Ver actividad reciente" toggle.
- Tapping the toggle expands a timeline of events with icon, type label, and relative time.
- Tapping again collapses it.
- When `events` is empty, no toggle is shown.
- `flutter analyze` reports 0 new issues.
