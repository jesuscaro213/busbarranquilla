import 'dart:io';
import 'dart:math';

import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

class LocationService {
  /// Basic "while in use" permission — used by map, planner, boarding.
  static Future<bool> requestLocationPermission() async {
    final permissionStatus = await Permission.locationWhenInUse.request();
    if (!permissionStatus.isGranted) return false;

    final geolocatorPermission = await Geolocator.checkPermission();
    if (geolocatorPermission == LocationPermission.denied ||
        geolocatorPermission == LocationPermission.deniedForever) {
      final requested = await Geolocator.requestPermission();
      return requested == LocationPermission.whileInUse ||
          requested == LocationPermission.always;
    }

    return true;
  }

  /// Requests "Always allow" permission for background location during trips.
  /// On Android 10+: first grants "While in use", then prompts user to go to
  /// Settings and select "Allow all the time".
  /// Returns true if always permission is granted (or at least whileInUse).
  static Future<bool> requestBackgroundPermission() async {
    // Step 1: ensure "while in use" is granted first.
    final whenInUse = await Permission.locationWhenInUse.request();
    if (!whenInUse.isGranted) return false;

    // Step 2: request "always" — on Android 10+ this opens the Settings page
    // with the "Allow all the time" option highlighted.
    final always = await Permission.locationAlways.request();
    if (always.isGranted) return true;

    // Fall back to "while in use" — the trip still works while the app is open.
    return whenInUse.isGranted;
  }

  /// Background-capable position stream for active trips.
  ///
  /// Android: starts a persistent foreground service notification so the OS
  /// never kills the location process when the app is backgrounded.
  ///
  /// iOS: enables background location updates so GPS continues when the screen
  /// is locked or the user switches apps.
  static Stream<Position> get backgroundPositionStream {
    if (Platform.isAndroid) {
      return Geolocator.getPositionStream(
        locationSettings: AndroidSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 10,
          intervalDuration: const Duration(seconds: 20),
          foregroundNotificationConfig: const ForegroundNotificationConfig(
            notificationTitle: 'MiBus — Viaje activo',
            notificationText: 'Transmitiendo tu ubicación en tiempo real 🚌',
            enableWakeLock: true,
            notificationIcon: AndroidResource(
              name: 'ic_launcher',
              defType: 'mipmap',
            ),
          ),
        ),
      );
    }

    if (Platform.isIOS) {
      return Geolocator.getPositionStream(
        locationSettings: AppleSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 10,
          allowBackgroundLocationUpdates: true,
          pauseLocationUpdatesAutomatically: false,
          activityType: ActivityType.automotiveNavigation,
        ),
      );
    }

    // Fallback for other platforms.
    return Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      ),
    );
  }

  static Future<Position?> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return null;

    final hasPermission = await requestLocationPermission();
    if (!hasPermission) return null;

    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }

  static double distanceKm(
    double lat1,
    double lng1,
    double lat2,
    double lng2,
  ) {
    const earthRadiusKm = 6371.0;
    final dLat = (lat2 - lat1) * pi / 180;
    final dLng = (lng2 - lng1) * pi / 180;

    final a =
        sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * pi / 180) *
            cos(lat2 * pi / 180) *
            sin(dLng / 2) *
            sin(dLng / 2);

    return earthRadiusKm * 2 * atan2(sqrt(a), sqrt(1 - a));
  }

  static double distanceMeters(
    double lat1,
    double lng1,
    double lat2,
    double lng2,
  ) =>
      distanceKm(lat1, lng1, lat2, lng2) * 1000;

  /// Minimum distance in meters from [lat,lng] to any vertex of [geometry].
  /// Uses point-to-nearest-vertex (O(n)) which is sufficient for route validation.
  static double minDistToPolyline(
    double lat,
    double lng,
    List<dynamic> geometry, // List<LatLng> accepted via duck-typing
  ) {
    double min = double.infinity;
    for (final point in geometry) {
      final d = distanceMeters(lat, lng, point.latitude as double, point.longitude as double);
      if (d < min) min = d;
    }
    return min;
  }
}
