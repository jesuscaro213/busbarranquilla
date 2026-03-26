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
  final bool desvioIsRepeat;
  final bool showDesvioEscalate;
  final bool desvioConfirmPending;
  final bool desvioEscalateIsTranscon;
  final bool dropoffPrompt;
  final bool noMapPickRequested;
  /// When true the screen skips the payment-confirmation dialog and goes
  /// straight to the destination picker (used when boardingAlerts pref is
  /// already enabled and no destination was pre-selected).
  final bool dropoffAutoPickDestination;
  final bool showSuspiciousModal;
  final String? reportError;
  /// Non-error informational message (shown as info snackbar, then cleared).
  final String? infoMessage;
  final bool gpsLost;
  final String? occupancyState;
  /// Exact coordinates the user picked on the map as destination (green pin).
  /// Distinct from the nearest stop used by the dropoff monitor (red pin).
  final double? pickedDestLat;
  final double? pickedDestLng;

  const TripActive({
    required this.trip,
    required this.route,
    required this.stops,
    required this.reports,
    this.dropoffAlert,
    this.showInactivityModal = false,
    this.desvioDetected = false,
    this.desvioIsRepeat = false,
    this.showDesvioEscalate = false,
    this.desvioConfirmPending = false,
    this.desvioEscalateIsTranscon = false,
    this.dropoffPrompt = false,
    this.noMapPickRequested = false,
    this.dropoffAutoPickDestination = false,
    this.showSuspiciousModal = false,
    this.reportError,
    this.infoMessage,
    this.gpsLost = false,
    this.occupancyState,
    this.pickedDestLat,
    this.pickedDestLng,
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
    bool? desvioIsRepeat,
    bool? showDesvioEscalate,
    bool? desvioConfirmPending,
    bool? desvioEscalateIsTranscon,
    bool? dropoffPrompt,
    bool? noMapPickRequested,
    bool? dropoffAutoPickDestination,
    bool? showSuspiciousModal,
    String? reportError,
    bool clearReportError = false,
    String? infoMessage,
    bool clearInfoMessage = false,
    bool? gpsLost,
    String? occupancyState,
    bool clearOccupancyState = false,
    double? pickedDestLat,
    double? pickedDestLng,
    bool clearPickedDest = false,
  }) {
    return TripActive(
      trip: trip ?? this.trip,
      route: route ?? this.route,
      stops: stops ?? this.stops,
      reports: reports ?? this.reports,
      dropoffAlert: clearDropoffAlert ? null : (dropoffAlert ?? this.dropoffAlert),
      showInactivityModal: showInactivityModal ?? this.showInactivityModal,
      desvioDetected: desvioDetected ?? this.desvioDetected,
      desvioIsRepeat: desvioIsRepeat ?? this.desvioIsRepeat,
      showDesvioEscalate: showDesvioEscalate ?? this.showDesvioEscalate,
      desvioConfirmPending: desvioConfirmPending ?? this.desvioConfirmPending,
      desvioEscalateIsTranscon: desvioEscalateIsTranscon ?? this.desvioEscalateIsTranscon,
      dropoffPrompt: dropoffPrompt ?? this.dropoffPrompt,
      noMapPickRequested: noMapPickRequested ?? this.noMapPickRequested,
      dropoffAutoPickDestination: dropoffAutoPickDestination ?? this.dropoffAutoPickDestination,
      showSuspiciousModal: showSuspiciousModal ?? this.showSuspiciousModal,
      reportError: clearReportError ? null : (reportError ?? this.reportError),
      infoMessage: clearInfoMessage ? null : (infoMessage ?? this.infoMessage),
      gpsLost: gpsLost ?? this.gpsLost,
      occupancyState: clearOccupancyState ? null : (occupancyState ?? this.occupancyState),
      pickedDestLat: clearPickedDest ? null : (pickedDestLat ?? this.pickedDestLat),
      pickedDestLng: clearPickedDest ? null : (pickedDestLng ?? this.pickedDestLng),
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
  final bool deviationDetected;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
    this.reportsCreated = 0,
    this.streakDays = 0,
    this.deviationDetected = false,
  });
}
