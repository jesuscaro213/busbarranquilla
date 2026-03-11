import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';

sealed class TripState {
  const TripState();
}

enum DropoffAlert { prepare, alight, missed }

final class TripIdle extends TripState {
  const TripIdle();
}

final class TripLoading extends TripState {
  const TripLoading();
}

final class TripActive extends TripState {
  final ActiveTrip trip;
  final BusRoute route;
  final List<Stop> stops;
  final List<Report> reports;
  final DropoffAlert? dropoffAlert;
  final bool showInactivityModal;
  final bool desvioDetected;

  const TripActive({
    required this.trip,
    required this.route,
    required this.stops,
    required this.reports,
    this.dropoffAlert,
    this.showInactivityModal = false,
    this.desvioDetected = false,
  });

  TripActive copyWith({
    ActiveTrip? trip,
    BusRoute? route,
    List<Stop>? stops,
    List<Report>? reports,
    DropoffAlert? dropoffAlert,
    bool? showInactivityModal,
    bool? desvioDetected,
  }) {
    return TripActive(
      trip: trip ?? this.trip,
      route: route ?? this.route,
      stops: stops ?? this.stops,
      reports: reports ?? this.reports,
      dropoffAlert: dropoffAlert ?? this.dropoffAlert,
      showInactivityModal: showInactivityModal ?? this.showInactivityModal,
      desvioDetected: desvioDetected ?? this.desvioDetected,
    );
  }
}

final class TripError extends TripState {
  final String message;

  const TripError(this.message);
}

final class TripEnded extends TripState {
  final String routeName;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final Duration tripDuration;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
  });
}
