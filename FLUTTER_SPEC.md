# MiBus — Flutter Mobile App Spec

## Project overview

**MiBus** (mibus.co) is a collaborative real-time public transport app for Barranquilla, Colombia.
The passenger IS the GPS: users report bus locations in real time. The system rewards participation with credits and offers a Premium subscription.

This document is a complete spec for building the Flutter mobile app that consumes the existing backend API.

---

## Clean code rules — non-negotiable

These rules apply to every file in the project. Codex must follow them strictly:

1. **No copy-paste.** Every piece of logic that is used more than once lives in a shared abstraction (widget, utility, mixin, base class, or provider).
2. **Single responsibility.** Every class, function, and file does exactly one thing. If you need to add "and" to describe what a file does, split it.
3. **No business logic in widgets.** Widgets only call providers/notifiers and render state. All API calls, calculations, and decisions happen in the data or domain layer.
4. **No hardcoded strings in widgets.** All user-facing strings go in `lib/core/l10n/strings.dart`. All API paths go in `lib/core/api/api_paths.dart`. All colors and sizes go in the theme.
5. **No raw `dio.get(...)` calls outside repositories.** The only place that talks to the network is a `*Repository` class.
6. **Typed errors, not strings.** Use a `Result<T>` / `AppError` pattern. Never return `dynamic` or catch errors silently.
7. **Named constructors / factory methods for models.** Every model has `fromJson(Map<String, dynamic>)` and `toJson()`. No JSON parsing outside models.
8. **Providers are thin.** A Riverpod `Notifier` only orchestrates repositories and emits state. It does not contain loops, math, or string manipulation.
9. **No `setState` outside of simple local UI state** (e.g., form field focus). All shared state goes through Riverpod.
10. **One export per barrel file.** Each feature folder has an `index.dart` that exports its public API.

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Flutter 3.x (Dart) | |
| State management | Riverpod 2.x (`@riverpod` codegen) | All providers use `@riverpod` annotation |
| HTTP | `dio` | Single instance, JWT interceptor, error interceptor |
| Maps | `flutter_map` + OpenStreetMap | |
| Real-time | `socket_io_client` | Singleton service |
| Secure storage | `flutter_secure_storage` | Token only |
| Preferences | `shared_preferences` | Non-sensitive prefs |
| Location | `geolocator` + `permission_handler` | |
| Navigation | `go_router` | Declarative, auth guard |
| Notifications | `flutter_local_notifications` | Drop-off alerts |
| DI | Riverpod `Provider` | No `get_it` needed |

---

## Architecture — Clean Architecture (3 layers)

```
Presentation  →  Domain  →  Data
(widgets,          (models,     (repositories,
 providers)         use cases)   remote data sources,
                                 local data sources)
```

### Rules per layer

**Data layer** (`lib/core/data/`):
- `RemoteDataSource`: raw API calls, returns `Map<String, dynamic>` or throws `DioException`
- `Repository`: calls data source, converts to models, wraps in `Result<T>`, handles errors
- Models: `fromJson` / `toJson`, immutable (`@freezed` or manual `copyWith`)

**Domain layer** (`lib/core/domain/`):
- Plain Dart models (no Flutter imports)
- One `UseCase` class per user action when logic is non-trivial (e.g., `StartTripUseCase`, `ConfirmReportUseCase`)
- No dependencies on Flutter or Dio

**Presentation layer** (`lib/features/*/`):
- Screens: one file per screen, thin — only layout + calling providers
- Widgets: extracted into `widgets/` subfolder; each widget is reusable and takes typed parameters
- Providers: one `*Notifier` per feature, calls repositories/use-cases, emits typed state

---

## Folder structure

```
lib/
├── main.dart                          # App entry, ProviderScope
├── app.dart                           # MaterialApp.router + GoRouter
│
├── core/
│   ├── api/
│   │   ├── api_client.dart            # Single Dio instance factory
│   │   ├── api_paths.dart             # All API path constants — NO paths anywhere else
│   │   └── interceptors/
│   │       ├── auth_interceptor.dart  # Attaches Bearer token
│   │       └── error_interceptor.dart # Maps DioException → AppError, handles 401
│   │
│   ├── data/
│   │   ├── sources/
│   │   │   ├── auth_remote_source.dart
│   │   │   ├── routes_remote_source.dart
│   │   │   ├── stops_remote_source.dart
│   │   │   ├── reports_remote_source.dart
│   │   │   ├── trips_remote_source.dart
│   │   │   ├── credits_remote_source.dart
│   │   │   ├── payments_remote_source.dart
│   │   │   └── users_remote_source.dart
│   │   └── repositories/
│   │       ├── auth_repository.dart
│   │       ├── routes_repository.dart
│   │       ├── stops_repository.dart
│   │       ├── reports_repository.dart
│   │       ├── trips_repository.dart
│   │       ├── credits_repository.dart
│   │       ├── payments_repository.dart
│   │       └── users_repository.dart
│   │
│   ├── domain/
│   │   ├── models/
│   │   │   ├── user.dart
│   │   │   ├── bus_route.dart
│   │   │   ├── stop.dart
│   │   │   ├── report.dart
│   │   │   ├── active_trip.dart
│   │   │   ├── plan_result.dart
│   │   │   └── credit_transaction.dart
│   │   └── use_cases/
│   │       ├── start_trip_use_case.dart
│   │       ├── end_trip_use_case.dart
│   │       ├── create_report_use_case.dart
│   │       └── confirm_report_use_case.dart
│   │
│   ├── error/
│   │   ├── app_error.dart             # Sealed class: NetworkError, AuthError, ServerError, UnknownError
│   │   └── result.dart                # Result<T> = Success<T> | Failure
│   │
│   ├── socket/
│   │   └── socket_service.dart        # Singleton: connect, emit, listen, dispose
│   │
│   ├── location/
│   │   └── location_service.dart      # GPS stream, permission request, distance calc
│   │
│   ├── storage/
│   │   └── secure_storage.dart        # readToken, writeToken, deleteToken
│   │
│   ├── l10n/
│   │   └── strings.dart               # All user-facing strings as static const
│   │
│   └── theme/
│       ├── app_theme.dart             # ThemeData factory
│       ├── app_colors.dart            # All Color constants
│       └── app_text_styles.dart       # All TextStyle constants
│
├── features/
│   ├── auth/
│   │   ├── index.dart
│   │   ├── providers/
│   │   │   └── auth_provider.dart     # AuthNotifier: login, register, logout, profile
│   │   └── screens/
│   │       ├── login_screen.dart
│   │       └── register_screen.dart
│   │
│   ├── map/
│   │   ├── index.dart
│   │   ├── providers/
│   │   │   ├── map_provider.dart      # buses, reports, active feed
│   │   │   └── location_provider.dart # current GPS position stream
│   │   ├── screens/
│   │   │   └── map_screen.dart
│   │   └── widgets/
│   │       ├── bus_marker_layer.dart  # renders all bus markers
│   │       ├── report_marker_layer.dart
│   │       ├── route_polyline_layer.dart  # reused in map + planner + trip
│   │       ├── active_feed_bar.dart
│   │       └── report_bottom_sheet.dart
│   │
│   ├── planner/
│   │   ├── index.dart
│   │   ├── providers/
│   │   │   └── planner_provider.dart  # PlannerNotifier: search, plan, selectRoute
│   │   ├── screens/
│   │   │   └── planner_screen.dart
│   │   └── widgets/
│   │       ├── address_search_field.dart  # Nominatim autocomplete — reusable
│   │       ├── plan_result_card.dart
│   │       └── nearby_routes_list.dart
│   │
│   ├── trip/
│   │   ├── index.dart
│   │   ├── providers/
│   │   │   └── trip_provider.dart     # TripNotifier: start, updateLocation, end, monitors
│   │   ├── screens/
│   │   │   ├── boarding_screen.dart   # Step 1: route select
│   │   │   ├── stop_select_screen.dart # Step 2: destination stop
│   │   │   └── active_trip_screen.dart
│   │   └── widgets/
│   │       ├── report_create_sheet.dart
│   │       ├── route_reports_list.dart
│   │       └── trip_summary_sheet.dart
│   │
│   └── profile/
│       ├── index.dart
│       ├── providers/
│       │   └── profile_provider.dart  # credits balance, history
│       ├── screens/
│       │   ├── profile_screen.dart
│       │   └── credits_history_screen.dart
│       └── widgets/
│           ├── premium_card.dart
│           └── credit_history_tile.dart
│
└── shared/
    ├── widgets/
    │   ├── app_button.dart            # Primary / secondary / destructive variants
    │   ├── app_text_field.dart        # Styled text field with error state
    │   ├── app_bottom_sheet.dart      # Consistent bottom sheet wrapper
    │   ├── app_snackbar.dart          # show(context, message, type)
    │   ├── loading_indicator.dart     # Centered CircularProgressIndicator
    │   ├── error_view.dart            # Full-screen error + retry button
    │   ├── empty_view.dart            # Illustration + message for empty states
    │   ├── route_code_badge.dart      # Colored badge by route code prefix
    │   ├── distance_chip.dart         # Color-coded distance (green/amber/red)
    │   └── credit_badge.dart          # Credits display chip
    └── extensions/
        ├── datetime_extensions.dart   # timeAgo(), formatDate()
        ├── double_extensions.dart     # toDistanceString(), haversineKm()
        └── string_extensions.dart     # capitalize(), initials()
```

---

## Core abstractions — implement these first

### `result.dart`
```dart
sealed class Result<T> {
  const Result();
}

final class Success<T> extends Result<T> {
  final T data;
  const Success(this.data);
}

final class Failure<T> extends Result<T> {
  final AppError error;
  const Failure(this.error);
}

extension ResultExtension<T> on Result<T> {
  bool get isSuccess => this is Success<T>;
  T get data => (this as Success<T>).data;
  AppError get error => (this as Failure<T>).error;
  R fold<R>({ required R Function(T) onSuccess, required R Function(AppError) onFailure }) =>
      switch (this) {
        Success<T> s => onSuccess(s.data),
        Failure<T> f => onFailure(f.error),
      };
}
```

### `app_error.dart`
```dart
sealed class AppError {
  final String message;
  const AppError(this.message);
}

final class NetworkError extends AppError {
  const NetworkError() : super(AppStrings.errorNetwork);
}

final class AuthError extends AppError {
  const AuthError(String message) : super(message);
}

final class ServerError extends AppError {
  final int statusCode;
  const ServerError(String message, this.statusCode) : super(message);
}

final class UnknownError extends AppError {
  const UnknownError() : super(AppStrings.errorUnknown);
}
```

### `api_client.dart`
```dart
// Single Dio instance. All repositories receive this via Riverpod provider.
// NEVER create a new Dio() anywhere else.
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(baseUrl: ApiPaths.baseUrl));
  dio.interceptors.addAll([
    AuthInterceptor(ref.read(secureStorageProvider)),
    ErrorInterceptor(),
  ]);
  return dio;
});
```

### `api_paths.dart`
```dart
// ALL API paths live here. No path string anywhere else in the codebase.
abstract final class ApiPaths {
  static const baseUrl = 'https://api.mibus.co';

  // Auth
  static const login          = '/api/auth/login';
  static const register       = '/api/auth/register';
  static const profile        = '/api/auth/profile';

  // Routes
  static const routes         = '/api/routes';
  static const routesNearby   = '/api/routes/nearby';
  static const routesActiveFeed = '/api/routes/active-feed';
  static const routesPlan     = '/api/routes/plan';
  static String routeById(int id) => '/api/routes/$id';
  static String routeStops(int id) => '/api/stops/route/$id';

  // Reports
  static const reportsNearby  = '/api/reports/nearby';
  static const reports        = '/api/reports';
  static String reportConfirm(int id) => '/api/reports/$id/confirm';
  static String reportResolve(int id) => '/api/reports/$id/resolve';
  static String routeReports(int routeId) => '/api/reports/route/$routeId';

  // Trips
  static const tripStart      = '/api/trips/start';
  static const tripLocation   = '/api/trips/location';
  static const tripEnd        = '/api/trips/end';
  static const tripCurrent    = '/api/trips/current';
  static const tripBuses      = '/api/trips/buses';

  // Credits
  static const creditsBalance = '/api/credits/balance';
  static const creditsHistory = '/api/credits/history';
  static const creditsSpend   = '/api/credits/spend';

  // Payments
  static const paymentPlans   = '/api/payments/plans';
  static const paymentCheckout = '/api/payments/checkout';

  // Users
  static const favorites      = '/api/users/favorites';
  static String favoriteById(int routeId) => '/api/users/favorites/$routeId';
}
```

### `strings.dart`
```dart
// All user-facing strings. No hardcoded text in widgets.
abstract final class AppStrings {
  static const appName            = 'MiBus';
  static const errorNetwork       = 'Sin conexión. Verifica tu internet.';
  static const errorUnknown       = 'Algo salió mal. Intenta de nuevo.';
  static const errorServer        = 'Error del servidor. Intenta de nuevo.';

  static const loginTitle         = 'Iniciar sesión';
  static const registerTitle      = 'Crear cuenta';
  static const emailLabel         = 'Correo electrónico';
  static const passwordLabel      = 'Contraseña';
  static const nameLabel          = 'Nombre completo';
  static const phoneLabel         = 'Teléfono (opcional)';

  static const tabMap             = 'Mapa';
  static const tabRoutes          = 'Mis Rutas';
  static const tabTrip            = 'Viaje';
  static const tabProfile         = 'Perfil';

  static const boardedButton      = 'Me subí';
  static const alightedButton     = 'Me bajé';
  static const planButton         = 'Buscar rutas';
  static const originLabel        = 'Origen';
  static const destLabel          = 'Destino';

  static const reportTypes = {
    'trancon':        '🚗 Trancón',
    'lleno':          '🔴 Bus lleno',
    'bus_disponible': '🟢 Hay sillas',
    'sin_parar':      '⚠️ Sin parar en parada',
    'desvio':         '🔀 Desvío',
  };

  static const prepareToAlight    = 'Prepárate para bajar';
  static const alightNow          = '¡Bájate ya!';
  static const missedStop         = 'Pasaste tu parada';
  static const stillOnBus         = '¿Sigues en el bus?';

  static const premiumTitle       = 'MiBus Premium';
  static const creditsLabel       = 'créditos';
  static const distanceFar        = '(lejos)';
}
```

### `app_colors.dart`
```dart
abstract final class AppColors {
  static const primary       = Color(0xFF2563EB);
  static const primaryDark   = Color(0xFF1E3A5F);
  static const success       = Color(0xFF10B981);
  static const warning       = Color(0xFFF59E0B);
  static const error         = Color(0xFFEF4444);
  static const background    = Color(0xFFF9FAFB);
  static const surface       = Color(0xFFFFFFFF);
  static const textPrimary   = Color(0xFF111827);
  static const textSecondary = Color(0xFF6B7280);
  static const divider       = Color(0xFFE5E7EB);

  // Route code prefix colors
  static const routeA = Color(0xFF3B82F6); // blue
  static const routeB = Color(0xFF10B981); // green
  static const routeC = Color(0xFFF97316); // orange
  static const routeD = Color(0xFF8B5CF6); // purple
  static const routeDefault = Color(0xFF6B7280); // gray

  static Color forRouteCode(String code) {
    if (code.isEmpty) return routeDefault;
    return switch (code[0].toUpperCase()) {
      'A' => routeA,
      'B' => routeB,
      'C' => routeC,
      'D' => routeD,
      _   => routeDefault,
    };
  }

  static Color forDistance(int meters) {
    if (meters <= 300) return success;
    if (meters <= 600) return warning;
    return error;
  }
}
```

---

## Data layer pattern — implement identically for all repositories

### Remote data source (example: `auth_remote_source.dart`)
```dart
// Responsibility: raw HTTP calls only. Returns Map or throws DioException.
// No error catching here — the repository handles that.
class AuthRemoteSource {
  final Dio _dio;
  AuthRemoteSource(this._dio);

  Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await _dio.post(ApiPaths.login, data: {
      'email': email,
      'password': password,
    });
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> register(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.register, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getProfile() async {
    final response = await _dio.get(ApiPaths.profile);
    return response.data as Map<String, dynamic>;
  }
}
```

### Repository (example: `auth_repository.dart`)
```dart
// Responsibility: call source, parse model, wrap in Result, handle errors.
class AuthRepository {
  final AuthRemoteSource _source;
  final SecureStorage _storage;
  AuthRepository(this._source, this._storage);

  Future<Result<User>> login(String email, String password) async {
    try {
      final data = await _source.login(email, password);
      final token = data['token'] as String;
      final user = User.fromJson(data['user'] as Map<String, dynamic>);
      await _storage.writeToken(token);
      return Success(user);
    } on DioException catch (e) {
      return Failure(_mapDioError(e));
    }
  }

  Future<Result<User>> getProfile() async {
    try {
      final data = await _source.getProfile();
      return Success(User.fromJson(data['user'] as Map<String, dynamic>));
    } on DioException catch (e) {
      return Failure(_mapDioError(e));
    }
  }

  AppError _mapDioError(DioException e) {
    if (e.type == DioExceptionType.connectionError) return const NetworkError();
    final status = e.response?.statusCode;
    if (status == 401) return AuthError(e.response?.data['message'] ?? AppStrings.errorUnknown);
    final message = e.response?.data?['message'] as String? ?? AppStrings.errorServer;
    return ServerError(message, status ?? 500);
  }
}

// Riverpod provider
final authRepositoryProvider = Provider<AuthRepository>((ref) =>
  AuthRepository(
    AuthRemoteSource(ref.read(dioProvider)),
    ref.read(secureStorageProvider),
  ),
);
```

**Apply this exact same pattern for all 8 repositories.** Do not invent a different pattern for trips vs routes vs reports.

---

## Presentation layer pattern

### State (example: `auth_state.dart`)
```dart
@freezed  // or manual sealed class
sealed class AuthState {
  const factory AuthState.initial()              = AuthInitial;
  const factory AuthState.loading()              = AuthLoading;
  const factory AuthState.authenticated(User user) = Authenticated;
  const factory AuthState.unauthenticated()      = Unauthenticated;
  const factory AuthState.error(String message)  = AuthError;
}
```

### Notifier (example: `auth_provider.dart`)
```dart
// Thin: only orchestrates repository + emits state. No logic here.
@riverpod
class AuthNotifier extends _$AuthNotifier {
  @override
  AuthState build() => const AuthState.initial();

  Future<void> initialize() async {
    state = const AuthState.loading();
    final result = await ref.read(authRepositoryProvider).getProfile();
    state = result.fold(
      onSuccess: (user) => AuthState.authenticated(user),
      onFailure: (_) => const AuthState.unauthenticated(),
    );
  }

  Future<void> login(String email, String password) async {
    state = const AuthState.loading();
    final result = await ref.read(authRepositoryProvider).login(email, password);
    state = result.fold(
      onSuccess: (user) => AuthState.authenticated(user),
      onFailure: (e) => AuthState.error(e.message),
    );
  }

  Future<void> logout() async {
    await ref.read(secureStorageProvider).deleteToken();
    state = const AuthState.unauthenticated();
  }
}
```

### Screen (example: `login_screen.dart`)
```dart
// Only layout + reading state + calling notifier. Zero business logic.
class LoginScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(authNotifierProvider);

    // React to state changes via listener (navigate, show errors)
    ref.listen(authNotifierProvider, (_, next) {
      next.whenOrNull(
        authenticated: (_) => context.go('/map'),
        error: (msg) => AppSnackbar.show(context, msg, SnackbarType.error),
      );
    });

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              AppTextField(label: AppStrings.emailLabel, ...),
              AppTextField(label: AppStrings.passwordLabel, obscureText: true, ...),
              AppButton.primary(
                label: AppStrings.loginTitle,
                isLoading: state is AuthLoading,
                onPressed: () => ref.read(authNotifierProvider.notifier).login(email, password),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## Shared widgets — implement once, use everywhere

### `app_button.dart`
```dart
// Three factory constructors. No button code anywhere else.
class AppButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final _ButtonVariant _variant;

  const AppButton.primary({ required this.label, this.onPressed, this.isLoading = false })
    : _variant = _ButtonVariant.primary;

  const AppButton.secondary({ required this.label, this.onPressed, this.isLoading = false })
    : _variant = _ButtonVariant.secondary;

  const AppButton.destructive({ required this.label, this.onPressed, this.isLoading = false })
    : _variant = _ButtonVariant.destructive;

  @override
  Widget build(BuildContext context) { ... }
}
```

### `app_text_field.dart`
```dart
// Single styled text field with label + error + obscure toggle.
// All text fields in the app use this widget.
class AppTextField extends StatelessWidget {
  final String label;
  final String? errorText;
  final bool obscureText;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  ...
}
```

### `app_bottom_sheet.dart`
```dart
// All bottom sheets use this. No showModalBottomSheet call outside this class.
class AppBottomSheet {
  static Future<T?> show<T>(BuildContext context, { required Widget child, String? title }) =>
    showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, controller) => Column(children: [
          if (title != null) _SheetHeader(title: title),
          Expanded(child: SingleChildScrollView(controller: controller, child: child)),
        ]),
      ),
    );
}
```

### `route_code_badge.dart`
```dart
// Used in every route card and plan result. Single implementation.
class RouteCodeBadge extends StatelessWidget {
  final String code;
  const RouteCodeBadge({ required this.code, super.key });

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: AppColors.forRouteCode(code),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(code, style: AppTextStyles.badge.copyWith(color: Colors.white)),
  );
}
```

### `distance_chip.dart`
```dart
// Used in plan results. Color logic lives in AppColors, not here.
class DistanceChip extends StatelessWidget {
  final int meters;
  final String label;
  const DistanceChip({ required this.meters, required this.label, super.key });

  @override
  Widget build(BuildContext context) {
    final color = AppColors.forDistance(meters);
    final suffix = meters > 600 ? ' ${AppStrings.distanceFar}' : '';
    return Text('$meters m $label$suffix', style: AppTextStyles.body.copyWith(color: color));
  }
}
```

### `route_polyline_layer.dart`
```dart
// Renders a route geometry on flutter_map. Used in Map, Planner, and Trip screens.
// Pass geometry as List<LatLng>, never duplicate this rendering logic.
class RoutePolylineLayer extends StatelessWidget {
  final List<LatLng> points;
  final Color color;
  final double strokeWidth;

  const RoutePolylineLayer({
    required this.points,
    this.color = AppColors.primary,
    this.strokeWidth = 4,
    super.key,
  });

  @override
  Widget build(BuildContext context) => PolylineLayer(
    polylines: [Polyline(points: points, color: color, strokeWidth: strokeWidth)],
  );
}
```

---

## Location service — single source of truth

```dart
// lib/core/location/location_service.dart
// All location logic lives here. No Geolocator calls outside this class.
class LocationService {
  static Stream<Position> get positionStream => Geolocator.getPositionStream(
    locationSettings: const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    ),
  );

  static Future<Position?> getCurrentPosition() async {
    final permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      final result = await Geolocator.requestPermission();
      if (result == LocationPermission.denied) return null;
    }
    return Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
  }

  // Haversine — single implementation, used everywhere via extension or this method
  static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
    const R = 6371.0;
    final dLat = (lat2 - lat1) * pi / 180;
    final dLng = (lng2 - lng1) * pi / 180;
    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * pi / 180) * cos(lat2 * pi / 180) *
        sin(dLng / 2) * sin(dLng / 2);
    return R * 2 * atan2(sqrt(a), sqrt(1 - a));
  }

  static double distanceMeters(double lat1, double lng1, double lat2, double lng2) =>
    distanceKm(lat1, lng1, lat2, lng2) * 1000;
}
```

---

## Socket service — singleton

```dart
// lib/core/socket/socket_service.dart
// All Socket.io logic here. Features only call methods on this service.
class SocketService {
  static final SocketService _instance = SocketService._();
  static SocketService get instance => _instance;
  SocketService._();

  late final Socket _socket;
  bool _connected = false;

  void connect(String token) {
    if (_connected) return;
    _socket = io(ApiPaths.baseUrl, OptionBuilder()
      .setTransports(['websocket'])
      .setExtraHeaders({'Authorization': 'Bearer $token'})
      .enableAutoConnect()
      .enableReconnection()
      .build());
    _socket.onConnect((_) => _connected = true);
    _socket.onDisconnect((_) => _connected = false);
  }

  void disconnect() {
    _socket.disconnect();
    _connected = false;
  }

  void emit(String event, dynamic data) => _socket.emit(event, data);

  void on(String event, void Function(dynamic) handler) => _socket.on(event, handler);

  void off(String event) => _socket.off(event);

  // Typed helpers — feature code calls these, not emit() directly
  void joinRoute(int routeId)  => emit('join:route', routeId.toString());
  void leaveRoute(int routeId) => emit('leave:route', routeId.toString());
  void sendLocation(double lat, double lng) => emit('bus:location', {'lat': lat, 'lng': lng});
}
```

---

## Trip monitors — extracted to own classes

Do NOT put monitor logic inside `TripNotifier`. Each monitor is its own class:

```dart
// lib/features/trip/monitors/dropoff_monitor.dart
class DropoffMonitor {
  final Stop destination;
  final LocationService locationService;
  final VoidCallback onPrepare;   // 400 m
  final VoidCallback onAlight;    // 200 m + vibrate
  final VoidCallback onMissed;

  Timer? _timer;
  bool _alerted = false;

  void start() {
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
  }

  Future<void> _check() async {
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;
    final meters = LocationService.distanceMeters(
      pos.latitude, pos.longitude, destination.latitude, destination.longitude,
    );
    if (!_alerted && meters <= 400) { onPrepare(); }
    if (!_alerted && meters <= 200) { onAlight(); HapticFeedback.vibrate(); _alerted = true; }
  }

  void dispose() => _timer?.cancel();
}

// lib/features/trip/monitors/inactivity_monitor.dart
class InactivityMonitor {
  // ... similar pattern
}

// lib/features/trip/monitors/auto_resolve_monitor.dart
class AutoResolveMonitor {
  // ... similar pattern
}
```

`TripNotifier` only instantiates these monitors and calls `dispose()` on trip end.

---

## Navigation — `go_router`

```dart
// lib/app.dart — all routes defined here, nowhere else
final router = GoRouter(
  redirect: (context, state) {
    final isAuth = // ref.read(authNotifierProvider) is Authenticated
    final isGoingToAuth = state.matchedLocation.startsWith('/login') ||
                          state.matchedLocation.startsWith('/register');
    if (!isAuth && !isGoingToAuth) return '/login';
    if (isAuth && isGoingToAuth) return '/map';
    return null;
  },
  routes: [
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),
    ShellRoute(
      builder: (_, __, child) => MainShell(child: child),
      routes: [
        GoRoute(path: '/map', builder: (_, __) => const MapScreen()),
        GoRoute(path: '/planner', builder: (_, __) => const PlannerScreen()),
        GoRoute(path: '/trip', builder: (_, __) => const ActiveTripScreen()),
        GoRoute(path: '/trip/boarding', builder: (_, __) => const BoardingScreen()),
        GoRoute(path: '/trip/stop-select', builder: (_, __) => const StopSelectScreen()),
        GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen()),
        GoRoute(path: '/profile/credits', builder: (_, __) => const CreditsHistoryScreen()),
      ],
    ),
  ],
);
```

---

## Domain models

All models must have `fromJson`, `toJson`, `copyWith`. No JSON parsing outside models.

```dart
// lib/core/domain/models/bus_route.dart
class BusRoute {
  final int id;
  final String name;
  final String code;
  final String? companyName;
  final int? frequencyMinutes;
  final List<LatLng> geometry;   // already converted from [[lat,lng],...] in fromJson
  final bool isActive;

  const BusRoute({ required this.id, required this.name, required this.code,
    this.companyName, this.frequencyMinutes, this.geometry = const [], this.isActive = true });

  factory BusRoute.fromJson(Map<String, dynamic> json) => BusRoute(
    id:               json['id'] as int,
    name:             json['name'] as String,
    code:             json['code'] as String,
    companyName:      json['company_name'] as String?,
    frequencyMinutes: json['frequency_minutes'] as int?,
    isActive:         json['is_active'] as bool? ?? true,
    geometry: (json['geometry'] as List<dynamic>? ?? [])
      .map((p) => LatLng((p as List)[0] as double, p[1] as double))
      .toList(),
  );

  Map<String, dynamic> toJson() => { 'id': id, 'name': name, 'code': code, ... };
}

// lib/core/domain/models/plan_result.dart
class PlanResult {
  final int id;
  final String name;
  final String code;
  final String? companyName;
  final String? nearestStopName;
  final LatLng nearestStop;
  final int distanceMeters;        // dest walk
  final int? originDistanceMeters; // origin walk
  final int? frequencyMinutes;
  final List<LatLng> geometry;

  factory PlanResult.fromJson(Map<String, dynamic> json) => PlanResult(
    id:                   json['id'] as int,
    name:                 json['name'] as String,
    code:                 json['code'] as String,
    companyName:          json['company_name'] as String?,
    nearestStopName:      json['nearest_stop_name'] as String?,
    nearestStop:          LatLng(json['nearest_stop_lat'] as double, json['nearest_stop_lng'] as double),
    distanceMeters:       json['distance_meters'] as int,
    originDistanceMeters: json['origin_distance_meters'] as int?,
    frequencyMinutes:     json['frequency_minutes'] as int?,
    geometry: (json['geometry'] as List<dynamic>? ?? [])
      .map((p) => LatLng((p as List)[0] as double, p[1] as double))
      .toList(),
  );
}
```

Apply the same `fromJson` / `toJson` pattern to all models: `User`, `Stop`, `Report`, `ActiveTrip`, `CreditTransaction`.

---

## Backend API reference

### Base URL
`https://api.mibus.co`

### Auth header
`Authorization: Bearer <token>` on all protected endpoints.

### Endpoints

```
POST   /api/auth/login             body: {email, password}
POST   /api/auth/register          body: {name, email, password, phone?}
GET    /api/auth/profile           [auth]

GET    /api/routes                 [auth]
GET    /api/routes/nearby          [auth]  ?lat=&lng=&radius=0.3
GET    /api/routes/active-feed     [auth]
GET    /api/routes/plan            [auth]  ?originLat=&originLng=&destLat=&destLng=
GET    /api/routes/:id             [auth]
GET    /api/stops/route/:routeId   [auth]

GET    /api/reports/nearby         [auth]  ?lat=&lng=&radius=1
GET    /api/reports/route/:routeId [auth]
POST   /api/reports                [auth]  body: {route_id?, type, latitude, longitude, description?}
PUT    /api/reports/:id/confirm    [auth]
PATCH  /api/reports/:id/resolve    [auth]

POST   /api/trips/start            [auth]  body: {route_id, latitude, longitude, destination_stop_id?}
POST   /api/trips/location         [auth]  body: {latitude, longitude}
POST   /api/trips/end              [auth]
GET    /api/trips/current          [auth]
GET    /api/trips/buses            [auth]

GET    /api/credits/balance        [auth]
GET    /api/credits/history        [auth]  ?limit=20&offset=0
POST   /api/credits/spend          [auth]  body: {amount, feature, description}

GET    /api/payments/plans
POST   /api/payments/checkout      [auth]  body: {plan: "monthly"}  → {checkout_url}

GET    /api/users/favorites        [auth]
POST   /api/users/favorites        [auth]  body: {route_id}
DELETE /api/users/favorites/:routeId [auth]
```

### Report types
`trancon`, `lleno`, `bus_disponible`, `sin_parar`, `desvio`, `traffic`, `detour`, `no_service`, `espera`

### User roles
- `free` — default
- `premium` — `is_premium === true` OR `role === 'premium'`. Check both: `user.isPremium || user.role == 'premium'`
- `admin` — same as premium in mobile (no admin panel needed)

---

## WebSocket

```
Server: https://api.mibus.co  (Socket.io)

Emit (client → server):
  join:route    → routeId (string)        // on trip start
  leave:route   → routeId (string)        // on trip end
  bus:location  → {lat, lng}              // every 30 s while trip active

Listen (server → client):
  bus:location          → {userId, routeId, lat, lng}
  bus:joined            → {userId, routeId}
  bus:left              → {userId, routeId}
  route:new_report      → report object
  route:report_confirmed → {reportId, confirmations}
```

---

## Permissions

| Permission | When to request | Why |
|-----------|----------------|-----|
| `locationWhenInUse` | On Map screen first load | Show user on map |
| `locationAlways` | When trip starts | Background location broadcasting |
| Vibration | Implicit | Drop-off alert at 200 m |

Show a custom explanation dialog before each system permission dialog.

---

## App initialization

```
1. Splash screen
2. Read token from secure storage
3. If token → GET /api/auth/profile
   - 200 → AuthState.authenticated → router goes to /map
   - 401 → clear token → AuthState.unauthenticated → /login
4. No token → /login
5. On /map:
   - Request location permission
   - Connect Socket.io
   - GET /api/trips/current → if active trip exists, go to /trip
   - Load active buses + reports + feed (parallel)
```

---

## Business rules

- New users: **50 credits** + **14-day premium trial**
- Reports expire after **30 minutes** — filter by `expires_at` before displaying
- Premium check: `user.isPremium == true || user.role == 'premium'` — always check both
- Drop-off alerts: premium/admin = free; free users spend 12 credits per trip
- Credits earned while trip active:
  - +1/min for broadcasting location
  - +10 on trip end
  - +1 for report (alone on bus), +2 if others confirm
  - +1 for confirming another's report (max 3/trip)

---

## Implementation order

1. `core/` setup: `result.dart`, `app_error.dart`, `app_colors.dart`, `strings.dart`, `app_theme.dart`
2. `api_client.dart` + `api_paths.dart` + interceptors
3. `secure_storage.dart` + `location_service.dart` + `socket_service.dart`
4. All 8 domain models with `fromJson`
5. All 8 remote data sources
6. All 8 repositories
7. All shared widgets (`app_button`, `app_text_field`, `app_bottom_sheet`, `route_code_badge`, `distance_chip`, `route_polyline_layer`)
8. `go_router` setup + `MainShell`
9. Auth feature: notifier + login + register screens
10. Map feature: buses + reports + feed
11. Trip feature: boarding flow + active trip + monitors
12. Planner feature: address search + plan results
13. Profile feature: credits + premium card
14. Favorites feature
