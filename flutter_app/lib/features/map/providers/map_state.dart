import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';

sealed class MapState {
  const MapState();
}

final class MapLoading extends MapState {
  const MapLoading();
}

final class MapError extends MapState {
  final String message;

  const MapError(this.message);
}

final class MapReady extends MapState {
  final LatLng? userPosition;
  final List<ActiveTrip> buses;
  final List<Report> reports;
  final List<BusRoute> activeFeedRoutes;
  final int? activeTripRouteId;

  const MapReady({
    required this.userPosition,
    required this.buses,
    required this.reports,
    required this.activeFeedRoutes,
    required this.activeTripRouteId,
  });

  MapReady copyWith({
    LatLng? userPosition,
    List<ActiveTrip>? buses,
    List<Report>? reports,
    List<BusRoute>? activeFeedRoutes,
    int? activeTripRouteId,
  }) {
    return MapReady(
      userPosition: userPosition ?? this.userPosition,
      buses: buses ?? this.buses,
      reports: reports ?? this.reports,
      activeFeedRoutes: activeFeedRoutes ?? this.activeFeedRoutes,
      activeTripRouteId: activeTripRouteId ?? this.activeTripRouteId,
    );
  }
}
