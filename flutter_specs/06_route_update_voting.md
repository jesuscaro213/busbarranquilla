# Spec 06 — Route Update Voting (Trancón / Ruta Real)

## Web equivalent

`CatchBusMode.tsx` active trip view — two vote buttons:
- **"Hay trancón"** (`trancon`) — bus is stuck in traffic
- **"Ruta real difiere"** (`ruta_real`) — the bus is taking a different route than the map shows

Each vote is an upsert: one vote per user per route. When ≥3 users vote `ruta_real` → admin alert triggered.

## Backend endpoint

`POST /api/routes/:id/update-report` (auth required)

Body: `{ "tipo": "trancon" | "ruta_real" }`

Response: `{ "message": "Reporte de actualización registrado" }`

---

## Step 1 — API path

**File:** `lib/core/api/api_paths.dart`

Add:
```dart
static String routeUpdateReport(int id) => '/api/routes/$id/update-report';
```

---

## Step 2 — Remote source

**File:** `lib/core/data/sources/routes_remote_source.dart`

Add method:
```dart
Future<void> reportRouteUpdate(int routeId, String tipo) async {
  await _dio.post(
    ApiPaths.routeUpdateReport(routeId),
    data: <String, String>{'tipo': tipo},
  );
}
```

---

## Step 3 — Repository

**File:** `lib/core/data/repositories/routes_repository.dart`

Add method:
```dart
Future<Result<void>> reportRouteUpdate(int routeId, String tipo) async {
  try {
    await _source.reportRouteUpdate(routeId, tipo);
    return const Success<void>(null);
  } on DioException catch (e) {
    return Failure<void>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<void>(UnknownError());
  }
}
```

---

## Step 4 — Strings

**File:** `lib/core/l10n/strings.dart`

Add:
```dart
static const reportRouteTitle = 'Reportar problema de ruta';
static const reportTrancon = 'Hay trancón';
static const reportRutaReal = 'Ruta difiere del mapa';
static const reportRouteSent = 'Reporte enviado. ¡Gracias!';
static const reportRouteError = 'No se pudo enviar el reporte';
static const reportTranconDesc = 'El bus está atascado en tráfico';
static const reportRutaRealDesc = 'El bus tomó una ruta diferente a la del mapa';
```

---

## Step 5 — RouteUpdateSheet widget

**File:** `lib/features/trip/widgets/route_update_sheet.dart` (new file)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';

class RouteUpdateSheet extends ConsumerStatefulWidget {
  final int routeId;

  const RouteUpdateSheet({required this.routeId, super.key});

  @override
  ConsumerState<RouteUpdateSheet> createState() => _RouteUpdateSheetState();
}

class _RouteUpdateSheetState extends ConsumerState<RouteUpdateSheet> {
  bool _loading = false;

  Future<void> _send(String tipo) async {
    setState(() => _loading = true);
    final result = await ref
        .read(routesRepositoryProvider)
        .reportRouteUpdate(widget.routeId, tipo);
    if (!mounted) return;
    setState(() => _loading = false);

    switch (result) {
      case Success<void>():
        AppSnackbar.show(context, AppStrings.reportRouteSent);
        Navigator.of(context).pop();
      case Failure<void>(error: final error):
        AppSnackbar.show(
          context,
          error.message.isNotEmpty ? error.message : AppStrings.reportRouteError,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          AppStrings.reportRouteTitle,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 16),
        if (_loading)
          const Center(child: CircularProgressIndicator())
        else ...<Widget>[
          _VoteOption(
            icon: Icons.traffic,
            title: AppStrings.reportTrancon,
            subtitle: AppStrings.reportTranconDesc,
            color: Colors.orange,
            onTap: () => _send('trancon'),
          ),
          const SizedBox(height: 10),
          _VoteOption(
            icon: Icons.alt_route,
            title: AppStrings.reportRutaReal,
            subtitle: AppStrings.reportRutaRealDesc,
            color: AppColors.error,
            onTap: () => _send('ruta_real'),
          ),
        ],
      ],
    );
  }
}

class _VoteOption extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _VoteOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          border: Border.all(color: color.withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, color: color, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: const TextStyle(fontSize: 12),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: color),
          ],
        ),
      ),
    );
  }
}
```

Add export to `lib/features/trip/widgets/index.dart`:
```dart
export 'route_update_sheet.dart';
```

---

## Step 6 — ActiveTripScreen: add "Reportar ruta" button

**File:** `lib/features/trip/screens/active_trip_screen.dart`

Read the file first. Find the AppBar actions or the bottom action row.

Add a button that opens `RouteUpdateSheet` via `AppBottomSheet`:

```dart
import '../widgets/route_update_sheet.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';

// In the AppBar actions or as an IconButton in the UI, add:
IconButton(
  icon: const Icon(Icons.warning_amber_outlined),
  tooltip: AppStrings.reportRouteTitle,
  onPressed: () {
    final active = ref.read(tripNotifierProvider);
    if (active is! TripActive) return;
    final routeId = active.route.id;
    AppBottomSheet.show(
      context,
      child: RouteUpdateSheet(routeId: routeId),
    );
  },
),
```

**Note:** Check how `AppBottomSheet.show()` works in `lib/shared/widgets/app_bottom_sheet.dart` and use the correct API.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: route update voting (trancon / ruta real) in active trip`
