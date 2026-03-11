import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/l10n/strings.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_notifier.dart';
import 'features/auth/providers/auth_state.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/map/screens/map_screen.dart';
import 'features/planner/screens/planner_screen.dart';
import 'features/profile/screens/credits_history_screen.dart';
import 'features/profile/screens/profile_screen.dart';
import 'features/profile/screens/trip_history_screen.dart';
import 'features/shell/main_shell.dart';
import 'features/trip/screens/active_trip_screen.dart';
import 'features/trip/screens/boarding_confirm_screen.dart';
import 'features/trip/screens/boarding_screen.dart';
import 'features/trip/screens/stop_select_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/map',
    redirect: (context, state) {
      final isGoingToAuth =
          state.matchedLocation == '/login' || state.matchedLocation == '/register';
      final isLoading = state.matchedLocation == '/loading';

      return switch (authState) {
        AuthInitial() || AuthLoading() => isLoading ? null : '/loading',
        Authenticated() => isLoading || isGoingToAuth ? '/map' : null,
        Unauthenticated() || AuthErrorState() => isGoingToAuth ? null : '/login',
      };
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/loading',
        builder: (BuildContext context, GoRouterState state) => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
      GoRoute(
        path: '/login',
        builder: (BuildContext context, GoRouterState state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (BuildContext context, GoRouterState state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/trip/boarding',
        builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
      ),
      GoRoute(
        path: '/trip/confirm',
        builder: (BuildContext context, GoRouterState state) {
          final routeId = int.tryParse(state.uri.queryParameters['routeId'] ?? '');
          if (routeId == null) {
            return const Scaffold(
              body: Center(child: Text(AppStrings.tripStartError)),
            );
          }
          final destLat = double.tryParse(state.uri.queryParameters['destLat'] ?? '');
          final destLng = double.tryParse(state.uri.queryParameters['destLng'] ?? '');
          return BoardingConfirmScreen(
            routeId: routeId,
            destLat: destLat,
            destLng: destLng,
          );
        },
      ),
      GoRoute(
        path: '/trip/stop-select',
        builder: (BuildContext context, GoRouterState state) {
          final routeId = int.tryParse(state.uri.queryParameters['routeId'] ?? '');
          if (routeId == null) {
            return const Scaffold(
              body: Center(child: Text(AppStrings.tripStartError)),
            );
          }
          return StopSelectScreen(routeId: routeId);
        },
      ),
      GoRoute(
        path: '/profile/credits',
        builder: (BuildContext context, GoRouterState state) => const CreditsHistoryScreen(),
      ),
      GoRoute(
        path: '/profile/trips',
        builder: (BuildContext context, GoRouterState state) => const TripHistoryScreen(),
      ),
      ShellRoute(
        builder: (BuildContext context, GoRouterState state, Widget child) {
          return MainShell(child: child);
        },
        routes: <RouteBase>[
          GoRoute(
            path: '/map',
            builder: (BuildContext context, GoRouterState state) => const MapScreen(),
          ),
          GoRoute(
            path: '/planner',
            builder: (BuildContext context, GoRouterState state) => const PlannerScreen(),
          ),
          GoRoute(
            path: '/trip',
            builder: (BuildContext context, GoRouterState state) => const ActiveTripScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (BuildContext context, GoRouterState state) => const ProfileScreen(),
          ),
        ],
      ),
    ],
  );
});

class MiBusApp extends ConsumerWidget {
  const MiBusApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: AppStrings.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
