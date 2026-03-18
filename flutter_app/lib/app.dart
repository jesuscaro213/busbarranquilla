import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/notifications/notification_service.dart';

import 'core/data/repositories/auth_repository.dart';
import 'core/l10n/strings.dart';
import 'core/storage/onboarding_storage.dart' show onboardingDoneProvider;
import 'core/theme/app_theme.dart';
import 'features/auth/providers/auth_notifier.dart';
import 'features/auth/providers/auth_state.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/onboarding_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/auth/screens/splash_screen.dart';
import 'features/map/screens/map_pick_screen.dart';
import 'features/map/screens/map_screen.dart';
import 'features/planner/screens/planner_screen.dart';
import 'features/profile/screens/credits_history_screen.dart';
import 'features/profile/screens/help_screen.dart';
import 'features/profile/screens/profile_screen.dart';
import 'features/profile/screens/trip_history_screen.dart';
import 'features/shell/main_shell.dart';
import 'features/trip/providers/trip_notifier.dart';
import 'features/trip/providers/trip_state.dart';
import 'features/trip/screens/active_trip_screen.dart';
import 'features/trip/screens/boarding_confirm_screen.dart';
import 'features/trip/screens/boarding_screen.dart';
import 'features/trip/screens/stop_select_screen.dart';

// Notifier that lets GoRouter re-evaluate its redirect when auth/onboarding
// state changes, without recreating the GoRouter instance.
class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _RouterRefreshNotifier();

  // Listen to auth and onboarding changes — only notify GoRouter to
  // re-run redirect, never rebuild the router itself.
  ref.listen(authNotifierProvider, (_, __) => refreshNotifier.notify());
  ref.listen(onboardingDoneProvider, (_, __) => refreshNotifier.notify());
  ref.onDispose(refreshNotifier.dispose);

  return GoRouter(
    initialLocation: '/map',
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      // Read current values at redirect time (not captured at build time).
      final authState = ref.read(authNotifierProvider);
      final onboardingAsync = ref.read(onboardingDoneProvider);

      final isGoingToAuth =
          state.matchedLocation == '/login' || state.matchedLocation == '/register';
      final isLoading = state.matchedLocation == '/loading';
      final isOnboarding = state.matchedLocation == '/onboarding';

      // Onboarding takes priority — skip auth redirect entirely until done.
      final onboardingDone = onboardingAsync.valueOrNull ?? true;
      if (!onboardingDone) {
        return isOnboarding ? null : '/onboarding';
      }

      return switch (authState) {
        AuthInitial() || AuthLoading() => isLoading ? null : '/loading',
        Authenticated() => isLoading || isGoingToAuth ? '/map' : null,
        Unauthenticated() || AuthErrorState() => isGoingToAuth ? null : '/login',
      };
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/loading',
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) => const OnboardingScreen(),
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
          final setDestination =
              state.uri.queryParameters['setDestination'] == 'true';
          return StopSelectScreen(routeId: routeId, setDestination: setDestination);
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
      GoRoute(
        path: '/profile/help',
        builder: (BuildContext context, GoRouterState state) => const HelpScreen(),
      ),
      GoRoute(
        path: '/map-pick',
        builder: (BuildContext context, GoRouterState state) {
          final lat = double.tryParse(state.uri.queryParameters['lat'] ?? '');
          final lng = double.tryParse(state.uri.queryParameters['lng'] ?? '');
          return MapPickScreen(initialLat: lat, initialLng: lng);
        },
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
            path: '/trip/boarding',
            builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
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

class MiBusApp extends ConsumerStatefulWidget {
  const MiBusApp({super.key});

  @override
  ConsumerState<MiBusApp> createState() => _MiBusAppState();
}

class _MiBusAppState extends ConsumerState<MiBusApp> {
  @override
  void initState() {
    super.initState();

    // Tag Crashlytics reports with the authenticated user's ID so crashes
    // can be filtered by account in the Firebase console.
    ref.listen<AuthState>(authNotifierProvider, (_, next) {
      if (next is Authenticated) {
        FirebaseCrashlytics.instance
            .setUserIdentifier(next.user.id.toString());
      } else {
        FirebaseCrashlytics.instance.setUserIdentifier('');
      }
    });

    // App opened from background by tapping a notification
    NotificationService.setOnMessageOpenedApp(_handleNotificationTap);

    // App launched from terminated state by tapping a notification
    NotificationService.getInitialMessage().then((message) {
      if (message != null) _handleNotificationTap(message.data);
    });

    NotificationService.onNotificationTap = _handleLocalNotificationTap;
    NotificationService.getLaunchPayload().then((payload) {
      if (payload != null) _handleLocalNotificationTap(payload);
    });

    // Keep backend FCM token in sync when Android rotates it.
    NotificationService.listenTokenRefresh((newToken) {
      ref.read(authRepositoryProvider).updateFcmToken(newToken);
    });
  }

  void _handleNotificationTap(Map<String, dynamic> data) {
    final router = ref.read(appRouterProvider);
    final type = data['type'] as String?;
    final routeId = data['routeId'] as String?;

    switch (type) {
      case 'report':
        // New report on a route the user is on → go to active trip screen
        router.go('/trip');
      case 'report_resolved':
        router.go('/trip');
      case 'trip_ended':
        router.go('/profile/trips');
      default:
        if (routeId != null) {
          router.go('/trip');
        }
    }
  }

  void _handleLocalNotificationTap(String? payload) {
    if (payload == null) return;
    final router = ref.read(appRouterProvider);
    switch (payload) {
      case 'inactivity_check':
        router.go('/trip');
        break;
      case 'no_destination':
        router.go('/trip');
        WidgetsBinding.instance.addPostFrameCallback((_) {
          final s = ref.read(tripNotifierProvider);
          if (s is TripActive) {
            ref.read(tripNotifierProvider.notifier).requestMapPick();
          }
        });
        break;
      case 'boarding_alert_prepare':
      case 'boarding_alert_now':
        router.go('/trip');
        break;
      default:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    // GoRouter is created once — do NOT watch auth state here.
    // Changes trigger GoRouter.refreshListenable instead.
    final router = ref.watch(appRouterProvider);

    return MaterialApp.router(
      title: AppStrings.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
