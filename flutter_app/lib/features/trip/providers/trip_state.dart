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
  final bool dropoffPrompt;
  final bool showSuspiciousModal;
  final String? reportError;
  final bool gpsLost;
  final String? occupancyState;

  const TripActive({
    required this.trip,
    required this.route,
    required this.stops,
    required this.reports,
    this.dropoffAlert,
    this.showInactivityModal = false,
    this.desvioDetected = false,
    this.dropoffPrompt = false,
    this.showSuspiciousModal = false,
    this.reportError,
    this.gpsLost = false,
    this.occupancyState,
  });

  TripActive copyWith({
    ActiveTrip? trip,
    BusRoute? route,
    List<Stop>? stops,
    List<Report>? reports,
    DropoffAlert? dropoffAlert,
    bool clearDropoffAlert = false,
    bool? showInactivityModal,
    bool? desvioDetected,
    bool? dropoffPrompt,
    bool? showSuspiciousModal,
    String? reportError,
    bool clearReportError = false,
    bool? gpsLost,
    String? occupancyState,
    bool clearOccupancyState = false,
  }) {
    return TripActive(
      trip: trip ?? this.trip,
      route: route ?? this.route,
      stops: stops ?? this.stops,
      reports: reports ?? this.reports,
      dropoffAlert: clearDropoffAlert ? null : (dropoffAlert ?? this.dropoffAlert),
      showInactivityModal: showInactivityModal ?? this.showInactivityModal,
      desvioDetected: desvioDetected ?? this.desvioDetected,
      dropoffPrompt: dropoffPrompt ?? this.dropoffPrompt,
      showSuspiciousModal: showSuspiciousModal ?? this.showSuspiciousModal,
      reportError: clearReportError ? null : (reportError ?? this.reportError),
      gpsLost: gpsLost ?? this.gpsLost,
      occupancyState: clearOccupancyState ? null : (occupancyState ?? this.occupancyState),
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
  final int reportsCreated;
  final int streakDays;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
    this.reportsCreated = 0,
    this.streakDays = 0,
  });
}
