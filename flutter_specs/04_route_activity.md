# Spec 04 — Route Activity Panel

## Web equivalent

`CatchBusMode.tsx` waiting view + `PlanTripMode.tsx` result cards — shows activity summary:
- "N usuarios activos ahora"
- "Última actividad hace N min" (or "Sin actividad reciente")

## Backend endpoint

`GET /api/routes/:id/activity` (auth required)

Response:
```json
{
  "active_count": 3,
  "last_activity_minutes": 8,
  "events": [...],
  "active_positions": [[10.99, -74.81]]
}
```

---

## Step 1 — API path

**File:** `lib/core/api/api_paths.dart`

Add:
```dart
static String routeActivity(int id) => '/api/routes/$id/activity';
```

---

## Step 2 — Model

**File:** `lib/core/domain/models/route_activity.dart` (new file)

```dart
import 'model_parsers.dart';

class RouteActivity {
  final int activeCount;
  final int? lastActivityMinutes; // null if >60 min or no activity

  const RouteActivity({
    required this.activeCount,
    this.lastActivityMinutes,
  });

  factory RouteActivity.fromJson(Map<String, dynamic> json) {
    return RouteActivity(
      activeCount: asInt(json['active_count']),
      lastActivityMinutes: asIntOrNull(json['last_activity_minutes']),
    );
  }

  bool get hasActivity => activeCount > 0 || lastActivityMinutes != null;
}
```

Add export to `lib/core/domain/models/index.dart`:
```dart
export 'route_activity.dart';
```

---

## Step 3 — Remote source

**File:** `lib/core/data/sources/routes_remote_source.dart`

Add method to `RoutesRemoteSource`:
```dart
Future<Map<String, dynamic>> getActivity(int id) async {
  final response = await _dio.get(ApiPaths.routeActivity(id));
  return response.data as Map<String, dynamic>;
}
```

---

## Step 4 — Repository

**File:** `lib/core/data/repositories/routes_repository.dart`

Add method to `RoutesRepository`:
```dart
Future<Result<RouteActivity>> getActivity(int id) async {
  try {
    final data = await _source.getActivity(id);
    return Success<RouteActivity>(RouteActivity.fromJson(data));
  } on DioException catch (e) {
    return Failure<RouteActivity>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<RouteActivity>(UnknownError());
  }
}
```

Add import:
```dart
import '../models/route_activity.dart';
```

---

## Step 5 — Strings

**File:** `lib/core/l10n/strings.dart`

Add:
```dart
static const activityUsersActive = 'usuarios activos ahora';
static const activityOneUserActive = 'usuario activo ahora';
static const activityLastSeen = 'Última actividad hace';
static const activityLastSeenMin = 'min';
static const activityNone = 'Sin actividad reciente';
static const activityLoading = 'Verificando actividad...';
```

---

## Step 6 — RouteActivityBadge widget

**File:** `lib/shared/widgets/route_activity_badge.dart` (new file)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/data/repositories/routes_repository.dart';
import '../../core/domain/models/route_activity.dart';
import '../../core/error/result.dart';
import '../../core/l10n/strings.dart';
import '../../core/theme/app_colors.dart';

class RouteActivityBadge extends ConsumerStatefulWidget {
  final int routeId;

  const RouteActivityBadge({required this.routeId, super.key});

  @override
  ConsumerState<RouteActivityBadge> createState() => _RouteActivityBadgeState();
}

class _RouteActivityBadgeState extends ConsumerState<RouteActivityBadge> {
  RouteActivity? _activity;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future<void>(() => _load());
  }

  Future<void> _load() async {
    final result = await ref.read(routesRepositoryProvider).getActivity(widget.routeId);
    if (!mounted) return;
    if (result is Success<RouteActivity>) {
      setState(() {
        _activity = result.data;
        _loading = false;
      });
    } else {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Text(
        AppStrings.activityLoading,
        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
      );
    }

    final activity = _activity;
    if (activity == null || !activity.hasActivity) {
      return const Text(
        AppStrings.activityNone,
        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
      );
    }

    return Wrap(
      spacing: 8,
      children: <Widget>[
        if (activity.activeCount > 0)
          _Badge(
            icon: Icons.people_outline,
            label: '${activity.activeCount} '
                '${activity.activeCount == 1 ? AppStrings.activityOneUserActive : AppStrings.activityUsersActive}',
            color: AppColors.success,
          ),
        if (activity.lastActivityMinutes != null)
          _Badge(
            icon: Icons.access_time,
            label: '${AppStrings.activityLastSeen} '
                '${activity.lastActivityMinutes} '
                '${AppStrings.activityLastSeenMin}',
            color: AppColors.primary,
          ),
      ],
    );
  }
}

class _Badge extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;

  const _Badge({required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 12, color: color)),
      ],
    );
  }
}
```

Add export to `lib/shared/widgets/index.dart`:
```dart
export 'route_activity_badge.dart';
```

---

## Step 7 — BoardingConfirmScreen: show activity

**File:** `lib/features/trip/screens/boarding_confirm_screen.dart`

Read the file first to understand its layout. Then add `RouteActivityBadge` below the route name/code, before the boarding button:

```dart
import '../../../shared/widgets/route_activity_badge.dart';

// Inside build(), below the route info row, add:
const SizedBox(height: 8),
RouteActivityBadge(routeId: routeId), // use the actual routeId variable
const SizedBox(height: 12),
```

---

## Step 8 — PlanResultCard: show activity

**File:** `lib/features/planner/widgets/plan_result_card.dart`

Read the file first. After the distance chips / info rows, add the activity badge (collapsed by default, loaded lazily):

```dart
import '../../../shared/widgets/route_activity_badge.dart';

// Inside the card body, below the distance info:
const SizedBox(height: 6),
RouteActivityBadge(routeId: widget.result.routeId),
```

**Note:** `PlanResult` must have a `routeId` field. Check `lib/core/domain/models/plan_result.dart`. If `routeId` is not present, add it:
- In `PlanResult`: `final int routeId;`
- In `PlanResult.fromJson`: `routeId: asInt(json['route_id']),`
- In backend response `GET /api/routes/plan`, each result includes `route_id` — verify this is already returned.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: route activity badge in boarding confirm and plan results`
