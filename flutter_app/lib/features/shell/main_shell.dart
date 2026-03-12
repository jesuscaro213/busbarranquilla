import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/strings.dart';
import '../../core/theme/app_colors.dart';
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
  static const _tabs = <String>['/map', '/planner', '/trip', '/profile'];

  int _indexFromLocation(String location) {
    if (location.startsWith('/planner')) return 1;
    if (location.startsWith('/trip')) return 2;
    if (location.startsWith('/profile')) return 3;
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
    ref.listen<TripState>(tripNotifierProvider, (previous, next) {
      if (next is TripActive && previous is! TripActive) {
        final location = GoRouterState.of(context).matchedLocation;
        if (!location.startsWith('/trip')) {
          context.go('/trip');
        }
      }
    });

    final location = GoRouterState.of(context).matchedLocation;
    final isOnTrip = ref.watch(tripNotifierProvider.select((s) => s is TripActive));
    final currentIndex = isOnTrip ? 2 : _indexFromLocation(location);

    return Scaffold(
      body: widget.child,
      bottomNavigationBar: isOnTrip
          ? _TripActiveBar()
          : NavigationBar(
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
                  icon: Icon(Icons.directions_bus_outlined),
                  selectedIcon: Icon(Icons.directions_bus),
                  label: AppStrings.tabTrip,
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_outline),
                  selectedIcon: Icon(Icons.person),
                  label: AppStrings.tabProfile,
                ),
              ],
            ),
    );
  }
}

/// Slim bar shown instead of the full BottomNavigationBar during an active trip.
/// Prevents any navigation away from the trip view.
class _TripActiveBar extends StatelessWidget {
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
