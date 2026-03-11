# MiBus Flutter — Paridad Completa con Web (Usuario Normal)

## Propósito

Llevar la app Flutter a paridad total con la web para el flujo de **usuario normal y premium**.
**No incluye panel de administración** — eso es solo web.

Ejecutar cada spec en orden. Después de cada spec correr `flutter analyze` con 0 issues.

## Flutter binary

```
~/development/flutter/bin/flutter
```

## App root

```
/Users/jesuscaro/Documents/Trabajo/busbarranquilla/flutter_app
```

---

## Qué YA tiene Flutter (no tocar)

| Feature | Dónde está |
|---------|-----------|
| Login / Registro | `features/auth/` |
| Mapa con GPS, buses activos, marcadores | `features/map/` |
| Planeador de viaje (Nominatim, plan results, "Buses en tu zona") | `features/planner/` |
| Distancias con color (verde/ámbar/rojo) | `DistanceChip` + `AppColors.forDistance()` |
| Mini-mapa en resultados del planner | `PlanResultCard` (FLUTTER_SPEC_V4) |
| Marcadores origen/destino en mapa | `PlanMarkersLayer` (FLUTTER_SPEC_V4) |
| Boarding screen con "Cerca de ti" (scroll horizontal) | `features/trip/screens/boarding_screen.dart` |
| Pantalla confirmación de abordaje + auto-select parada | `boarding_confirm_screen.dart` |
| Viaje activo + transmisión de ubicación | `features/trip/` |
| 4 monitores: desvío, inactividad, auto-resolver, bajada | `features/trip/monitors/` |
| Reportes: crear, confirmar, lista en viaje activo | `features/trip/widgets/` |
| Socket: new_report, report_confirmed, join/leave route | `socket_service.dart` |
| Favoritos: agregar, quitar, lista | `features/planner/providers/favorites_provider.dart` |
| Créditos: balance + historial | `features/profile/screens/credits_history_screen.dart` |
| Perfil: info usuario, rol, trial | `features/profile/screens/profile_screen.dart` |
| Premium card + Wompi checkout (abre browser externo) | `features/profile/widgets/premium_card.dart` |
| Cooldown 5 min al iniciar viaje | `boarding_confirm_screen.dart` → muestra `TripError.message` como snackbar |

---

## Specs a ejecutar (en orden)

| # | Archivo | Feature | Estado web equivalente |
|---|---------|---------|----------------------|
| 01 | `01_trip_history.md` | Historial de viajes | `TripHistory.tsx` |
| 02 | `02_trip_summary_distance.md` | Resumen con distancia + bonus completación | `CatchBusMode` summary view |
| 03 | `03_report_resolved_socket.md` | Socket `route:report_resolved` | `CatchBusMode` monitors + waiting socket |
| 04 | `04_route_activity.md` | Badge actividad en boarding + planner | `CatchBusMode` waiting + `PlanTripMode` cards |
| 05 | `05_referral_code.md` | Código de referido en registro + perfil | `Register.tsx` + `Profile.tsx` |
| 06 | `06_route_update_voting.md` | Votar trancón / ruta real en viaje activo | `CatchBusMode` active trip |
| 07 | `07_parity_fixes.md` | Auto-resolve 200m→1km + nearby radius 500m→300m | Backend ya usa estos valores |

---

## Símbolos existentes clave (NO recrear)

| Símbolo | Archivo |
|---------|---------|
| `AppColors` | `lib/core/theme/app_colors.dart` |
| `AppStrings` | `lib/core/l10n/strings.dart` |
| `AppButton` | `lib/shared/widgets/app_button.dart` |
| `AppTextField` | `lib/shared/widgets/app_text_field.dart` |
| `AppBottomSheet` | `lib/shared/widgets/app_bottom_sheet.dart` |
| `AppSnackbar` | `lib/shared/widgets/app_snackbar.dart` |
| `EmptyView` | `lib/shared/widgets/empty_view.dart` |
| `LoadingIndicator` | `lib/shared/widgets/loading_indicator.dart` |
| `ErrorView` | `lib/shared/widgets/error_view.dart` |
| `RouteCodeBadge` | `lib/shared/widgets/route_code_badge.dart` |
| `DistanceChip` | `lib/shared/widgets/distance_chip.dart` |
| `ApiPaths` | `lib/core/api/api_paths.dart` |
| `dioProvider` | `lib/core/api/api_client.dart` |
| `Result<T>`, `Success`, `Failure` | `lib/core/error/result.dart` |
| `mappedErrorFromDio` | `lib/core/data/repositories/repository_helpers.dart` |
| `mapAt`, `listAt`, `intAt`, `asString`, etc. | `lib/core/data/repositories/repository_helpers.dart` |
| `socketServiceProvider` | `lib/core/socket/socket_service.dart` |
| `tripNotifierProvider` | `lib/features/trip/providers/trip_notifier.dart` |
| `TripActive`, `TripState` | `lib/features/trip/providers/trip_state.dart` |
| `selectedPlanRouteProvider` | `lib/features/planner/providers/planner_notifier.dart` |
| `DateTimeExtension.formatDate()` | `lib/shared/extensions/datetime_extensions.dart` |

---

## Reglas de arquitectura

- Remote sources: `lib/core/data/sources/`
- Repositories: `lib/core/data/repositories/`
- API paths: `lib/core/api/api_paths.dart`
- Strings: `lib/core/l10n/strings.dart` (nunca hardcodear español en widgets)
- Models: `lib/core/domain/models/`
- Screens: `lib/features/<feature>/screens/`
- Providers: `lib/features/<feature>/providers/`
- Rutas en `lib/app.dart` (GoRouter)
- **Sin nada de admin** — ningún endpoint `/api/admin/*` ni pantalla de administración

---

## Reglas de negocio (para contexto)

- Nuevo usuario: 50 créditos + 14 días premium trial
- Reportes expiran en 30 minutos
- Premium: $4,900 COP/mes vía Wompi, activa `is_premium=true` + 30 días + 50 créditos bonus
- Créditos por viaje: +1/min (velocidad >100m entre updates, máx 15/viaje)
- Bonus completación: +5 solo si recorrió ≥2 km
- Cooldown entre viajes: 5 minutos
- Confirmación de reporte: máx 2 créditos por viaje
- Auto-resolver trancón: bus se movió >1 km del lugar del reporte
- Alerta de bajada: gratis para premium/admin, cuesta 5 créditos para usuarios free
