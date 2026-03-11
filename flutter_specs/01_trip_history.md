# Spec 01 — Trip History Screen

## Web equivalent

`web/src/pages/TripHistory.tsx` — shows last 20 completed trips.
Accessible from `/profile` via "Tus últimos viajes" link.

## Backend endpoint

`GET /api/trips/history` (auth required)

Response:
```json
{
  "trips": [
    {
      "id": 1,
      "route_id": 5,
      "route_name": "Ruta del Sol",
      "route_code": "A01",
      "started_at": "2026-03-10T14:00:00Z",
      "ended_at": "2026-03-10T14:35:00Z",
      "credits_earned": 8,
      "duration_minutes": 35
    }
  ]
}
```

---

## Step 1 — API path

**File:** `lib/core/api/api_paths.dart`

Add inside `ApiPaths`:
```dart
static const tripHistory = '/api/trips/history';
```

---

## Step 2 — Remote source

**File:** `lib/core/data/sources/trips_remote_source.dart`

Add method to `TripsRemoteSource`:
```dart
Future<Map<String, dynamic>> getHistory() async {
  final response = await _dio.get(ApiPaths.tripHistory);
  return response.data as Map<String, dynamic>;
}
```

---

## Step 3 — Model

**File:** `lib/core/domain/models/trip_history_item.dart` (new file)

```dart
import 'model_parsers.dart';

class TripHistoryItem {
  final int id;
  final int? routeId;
  final String? routeName;
  final String? routeCode;
  final DateTime startedAt;
  final DateTime endedAt;
  final int creditsEarned;
  final int durationMinutes;

  const TripHistoryItem({
    required this.id,
    this.routeId,
    this.routeName,
    this.routeCode,
    required this.startedAt,
    required this.endedAt,
    required this.creditsEarned,
    required this.durationMinutes,
  });

  factory TripHistoryItem.fromJson(Map<String, dynamic> json) {
    return TripHistoryItem(
      id: asInt(json['id']),
      routeId: asIntOrNull(json['route_id']),
      routeName: asStringOrNull(json['route_name']),
      routeCode: asStringOrNull(json['route_code']),
      startedAt: asDateTime(json['started_at']),
      endedAt: asDateTime(json['ended_at']),
      creditsEarned: asInt(json['credits_earned']),
      durationMinutes: asInt(json['duration_minutes']),
    );
  }
}
```

**Check `model_parsers.dart`** — if `asIntOrNull` or `asDateTime` are missing, add them:
```dart
int? asIntOrNull(dynamic v) => v == null ? null : asInt(v);
DateTime asDateTime(dynamic v) => DateTime.parse(asString(v)).toLocal();
```

Add export to `lib/core/domain/models/index.dart`:
```dart
export 'trip_history_item.dart';
```

---

## Step 4 — Repository

**File:** `lib/core/data/repositories/trips_repository.dart`

Add method to `TripsRepository`:
```dart
Future<Result<List<TripHistoryItem>>> getHistory() async {
  try {
    final data = await _source.getHistory();
    final items = listAt(data, 'trips')
        .map(TripHistoryItem.fromJson)
        .toList(growable: false);
    return Success<List<TripHistoryItem>>(items);
  } on DioException catch (e) {
    return Failure<List<TripHistoryItem>>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<List<TripHistoryItem>>(UnknownError());
  }
}
```

Add import at top of file:
```dart
import '../models/trip_history_item.dart'; // or via index.dart if already exported
```

---

## Step 5 — Strings

**File:** `lib/core/l10n/strings.dart`

Add:
```dart
static const tripHistoryTitle = 'Tus últimos viajes';
static const tripHistoryEmpty = 'Aún no has hecho ningún viaje.';
static const tripHistoryEmptySub = '¡Sube a un bus y empieza!';
static const tripHistoryLink = 'Ver mis viajes';
static const tripDurationMinutes = 'min';
```

---

## Step 6 — Screen

**File:** `lib/features/profile/screens/trip_history_screen.dart` (new file)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/trips_repository.dart';
import '../../../core/domain/models/trip_history_item.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_code_badge.dart';

class TripHistoryScreen extends ConsumerStatefulWidget {
  const TripHistoryScreen({super.key});

  @override
  ConsumerState<TripHistoryScreen> createState() => _TripHistoryScreenState();
}

class _TripHistoryScreenState extends ConsumerState<TripHistoryScreen> {
  bool _loading = true;
  String? _error;
  List<TripHistoryItem> _trips = const <TripHistoryItem>[];

  @override
  void initState() {
    super.initState();
    Future<void>(() => _load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await ref.read(tripsRepositoryProvider).getHistory();
    switch (result) {
      case Success<List<TripHistoryItem>>(data: final data):
        setState(() {
          _trips = data;
          _loading = false;
        });
      case Failure<List<TripHistoryItem>>(error: final error):
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  String _formatDate(DateTime dt) {
    return '${dt.day.toString().padLeft(2, '0')}/'
        '${dt.month.toString().padLeft(2, '0')}/'
        '${dt.year} '
        '${dt.hour.toString().padLeft(2, '0')}:'
        '${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.tripHistoryTitle)),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _trips.isEmpty
                  ? const EmptyView(
                      icon: Icons.directions_bus_outlined,
                      message: AppStrings.tripHistoryEmpty,
                      subtitle: AppStrings.tripHistoryEmptySub,
                    )
                  : ListView.separated(
                      itemCount: _trips.length,
                      separatorBuilder: (_, __) =>
                          const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final trip = _trips[index];
                        return ListTile(
                          leading: trip.routeCode != null
                              ? RouteCodeBadge(code: trip.routeCode!)
                              : const Icon(Icons.directions_bus),
                          title: Text(
                            trip.routeName ?? AppStrings.tripNoRoute,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            '${_formatDate(trip.startedAt)} · '
                            '${trip.durationMinutes} ${AppStrings.tripDurationMinutes}',
                          ),
                          trailing: Text(
                            '+${trip.creditsEarned}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: AppColors.success,
                            ),
                          ),
                        );
                      },
                    ),
    );
  }
}
```

**Note:** If `EmptyView` does not accept a `subtitle` parameter, either add it or omit `subtitle` in the call.
Check `lib/shared/widgets/empty_view.dart` first.

---

## Step 7 — Router

**File:** `lib/app.dart`

Add import:
```dart
import 'features/profile/screens/trip_history_screen.dart';
```

Add route inside GoRouter routes (after the credits history route):
```dart
GoRoute(
  path: '/profile/trips',
  builder: (context, state) => const TripHistoryScreen(),
),
```

---

## Step 8 — Link from Profile

**File:** `lib/features/profile/screens/profile_screen.dart`

In `_ProfileReadyView.build()`, after the "Ver historial de créditos" `TextButton`, add:
```dart
Align(
  alignment: Alignment.centerLeft,
  child: TextButton(
    onPressed: () => context.go('/profile/trips'),
    child: const Text(AppStrings.tripHistoryLink),
  ),
),
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: trip history screen`
