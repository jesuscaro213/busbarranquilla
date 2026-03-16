import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/models/bus_route.dart';
import '../../core/l10n/strings.dart';
import '../../core/theme/app_colors.dart';
import '../map/providers/waiting_route_provider.dart';
import '../planner/providers/planner_notifier.dart';
import '../trip/providers/trip_notifier.dart';
import '../trip/providers/trip_state.dart';

class MainShell extends ConsumerStatefulWidget {
  final Widget child;

  const MainShell({required this.child, super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  static const _tabs = <String>['/map', '/planner', '/profile'];

  int _indexFromLocation(String location) {
    if (location.startsWith('/planner')) return 1;
    if (location.startsWith('/profile')) return 2;
    return 0;
  }

  @override
  void initState() {
    super.initState();
    // If app restarts while a trip is active, redirect to /trip once built.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final tripState = ref.read(tripNotifierProvider);
      if (tripState is TripActive) {
        final location = GoRouterState.of(context).matchedLocation;
        if (!location.startsWith('/trip')) {
          context.go('/trip');
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // Auto-navigate to /trip when a trip starts from any tab.
    // Also clears waiting mode here (shell is always in tree, unlike map_screen).
    ref.listen<TripState>(tripNotifierProvider, (previous, next) {
      if (next is TripActive && previous is! TripActive) {
        // Clear any pending waiting route — trip has started
        ref.read(selectedWaitingRouteProvider.notifier).state = null;
        final location = GoRouterState.of(context).matchedLocation;
        if (!location.startsWith('/trip')) {
          context.go('/trip');
        }
      }
      // Also clear on trip end to avoid stale waiting state after finishing
      if ((next is TripIdle || next is TripEnded) && previous is TripActive) {
        ref.read(selectedWaitingRouteProvider.notifier).state = null;
      }
    });

    // Auto-navigate to /map when waiting mode starts.
    ref.listen<BusRoute?>(selectedWaitingRouteProvider, (_, next) {
      if (next != null) {
        final location = GoRouterState.of(context).matchedLocation;
        if (!location.startsWith('/map')) {
          context.go('/map');
        }
      }
    });

    final location = GoRouterState.of(context).matchedLocation;
    final isOnTrip = ref.watch(tripNotifierProvider.select((s) => s is TripActive));
    final isWaiting = ref.watch(selectedWaitingRouteProvider) != null;
    final currentIndex = isOnTrip ? 2 : _indexFromLocation(location);

    // If waiting and somehow not on /map, redirect back immediately
    if (isWaiting && !isOnTrip && !location.startsWith('/map')) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/map');
      });
    }

    Widget bottomBar;
    if (isOnTrip) {
      bottomBar = const _TripActiveBar();
    } else if (isWaiting) {
      bottomBar = const _WaitingActiveBar();
    } else {
      bottomBar = NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (index) {
          if (index == 0) {
            ref.read(plannerNotifierProvider.notifier).reset();
          }
          context.go(_tabs[index]);
        },
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map),
            label: AppStrings.tabMap,
          ),
          NavigationDestination(
            icon: Icon(Icons.alt_route_outlined),
            selectedIcon: Icon(Icons.alt_route),
            label: AppStrings.tabRoutes,
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: AppStrings.tabProfile,
          ),
        ],
      );
    }

    return PopScope(
      // Block back navigation while waiting — user must cancel explicitly via the bar
      canPop: !isWaiting,
      child: Scaffold(
        body: widget.child,
        bottomNavigationBar: bottomBar,
      ),
    );
  }
}

// ── Trip active bar ───────────────────────────────────────────────────────────

class _TripActiveBar extends StatelessWidget {
  const _TripActiveBar();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56 + MediaQuery.of(context).padding.bottom,
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: AppColors.primary,
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(Icons.directions_bus, color: Colors.white, size: 20),
          SizedBox(width: 8),
          Text(
            AppStrings.tripActiveBar,
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w600,
              fontSize: 15,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Waiting active bar ────────────────────────────────────────────────────────

class _WaitingActiveBar extends ConsumerWidget {
  const _WaitingActiveBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final route = ref.watch(selectedWaitingRouteProvider);
    final bottomPad = MediaQuery.of(context).padding.bottom;

    return Container(
      height: 56 + bottomPad,
      padding: EdgeInsets.only(bottom: bottomPad),
      decoration: BoxDecoration(
        color: AppColors.primaryDark,
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Row(
          children: <Widget>[
            const Icon(Icons.notifications_active, color: Colors.amber, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    AppStrings.waitingActiveBar,
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (route != null)
                    Text(
                      '${route.code} · ${route.name}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: route == null
                  ? null
                  : () => context.push('/trip/confirm?routeId=${route.id}'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.success,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              icon: const Icon(Icons.directions_bus, size: 16),
              label: const Text(
                AppStrings.boardedWaitingButton,
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
            TextButton(
              onPressed: () {
                ref.read(selectedWaitingRouteProvider.notifier).state = null;
              },
              style: TextButton.styleFrom(
                foregroundColor: Colors.white70,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text(AppStrings.waitingCancel, style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ),
    );
  }
}
