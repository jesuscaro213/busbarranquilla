import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/active_trip.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';

class BusMarkerLayer extends StatelessWidget {
  final List<ActiveTrip> buses;

  const BusMarkerLayer({
    required this.buses,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final passengersByRoute = <int, int>{};
    for (final bus in buses) {
      final routeId = bus.routeId;
      if (routeId == null) continue;
      passengersByRoute[routeId] = (passengersByRoute[routeId] ?? 0) + 1;
    }

    return MarkerLayer(
      markers: buses
          .where((bus) => bus.currentLatitude != null && bus.currentLongitude != null)
          .map((bus) {
            final latLng = LatLng(bus.currentLatitude!, bus.currentLongitude!);
            final passengerCount = bus.routeId != null ? (passengersByRoute[bus.routeId] ?? 1) : 1;
            final routeName = bus.routeName ?? bus.routeCode ?? AppStrings.routeInProgress;

            return Marker(
              point: latLng,
              width: 36,
              height: 36,
              child: GestureDetector(
                onTap: () {
                  AppBottomSheet.show<void>(
                    context,
                    title: routeName,
                    child: Text('$passengerCount ${AppStrings.passengersLabel}'),
                  );
                },
                child: Container(
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.primary,
                  ),
                  child: const Icon(Icons.directions_bus, color: AppColors.surface, size: 20),
                ),
              ),
            );
          })
          .toList(growable: false),
    );
  }
}
