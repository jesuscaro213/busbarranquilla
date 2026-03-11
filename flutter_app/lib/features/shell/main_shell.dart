import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/strings.dart';
import '../planner/providers/planner_notifier.dart';
import '../trip/providers/trip_notifier.dart';
import '../trip/providers/trip_state.dart';

class MainShell extends ConsumerWidget {
  final Widget child;

  const MainShell({required this.child, super.key});

  static const _tabs = <String>['/map', '/planner', '/trip', '/profile'];

  int _indexFromLocation(String location) {
    if (location.startsWith('/planner')) return 1;
    if (location.startsWith('/trip')) return 2;
    if (location.startsWith('/profile')) return 3;
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final baseIndex = _indexFromLocation(location);
    final tripState = ref.watch(tripNotifierProvider);
    final currentIndex = tripState is TripActive ? 2 : baseIndex;

    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: currentIndex,
        type: BottomNavigationBarType.fixed,
        items: const <BottomNavigationBarItem>[
          BottomNavigationBarItem(
            icon: Icon(Icons.map_outlined),
            activeIcon: Icon(Icons.map),
            label: AppStrings.tabMap,
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.alt_route_outlined),
            activeIcon: Icon(Icons.alt_route),
            label: AppStrings.tabRoutes,
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.directions_bus_outlined),
            activeIcon: Icon(Icons.directions_bus),
            label: AppStrings.tabTrip,
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person_outline),
            activeIcon: Icon(Icons.person),
            label: AppStrings.tabProfile,
          ),
        ],
        onTap: (index) {
          if (index == 0) {
            ref.read(plannerNotifierProvider.notifier).reset();
          }
          context.go(_tabs[index]);
        },
      ),
    );
  }
}
