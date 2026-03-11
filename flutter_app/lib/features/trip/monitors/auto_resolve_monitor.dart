import 'dart:async';

import '../../../core/domain/models/report.dart';
import '../../../core/location/location_service.dart';

class AutoResolveMonitor {
  final List<Report> reports;
  final Future<void> Function(int reportId) onResolve;

  Timer? _timer;

  AutoResolveMonitor({
    required this.reports,
    required this.onResolve,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 120), (_) => _check());
  }

  Future<void> _check() async {
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    for (final report in reports) {
      final meters = LocationService.distanceMeters(
        pos.latitude,
        pos.longitude,
        report.latitude,
        report.longitude,
      );
      if (meters > 1000) {
        await onResolve(report.id);
      }
    }
  }

  void dispose() {
    _timer?.cancel();
  }
}
