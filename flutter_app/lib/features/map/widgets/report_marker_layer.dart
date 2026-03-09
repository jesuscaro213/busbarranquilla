import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/report.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';
import '../../../shared/widgets/app_button.dart';

class ReportMarkerLayer extends StatelessWidget {
  final List<Report> reports;
  final int? activeTripRouteId;
  final Future<void> Function(int reportId)? onConfirm;

  const ReportMarkerLayer({
    required this.reports,
    required this.activeTripRouteId,
    required this.onConfirm,
    super.key,
  });

  static const Map<String, Color> _colorByType = <String, Color>{
    'trancon': AppColors.warning,
    'traffic': AppColors.warning,
    'lleno': AppColors.error,
    'bus_full': AppColors.error,
    'bus_disponible': AppColors.success,
    'sin_parar': AppColors.primaryDark,
    'no_service': AppColors.primaryDark,
    'desvio': AppColors.primary,
    'detour': AppColors.primary,
  };

  @override
  Widget build(BuildContext context) {
    return MarkerLayer(
      markers: reports
          .map((report) {
            final canConfirm =
                onConfirm != null && activeTripRouteId != null && activeTripRouteId == report.routeId;
            final typeLabel = AppStrings.reportTypes[report.type] ?? report.type;
            final color = _colorByType[report.type] ?? AppColors.primaryDark;

            return Marker(
              point: LatLng(report.latitude, report.longitude),
              width: 32,
              height: 32,
              child: GestureDetector(
                onTap: () {
                  AppBottomSheet.show<void>(
                    context,
                    title: typeLabel,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Text(
                          report.createdAt != null ? report.createdAt!.timeAgo() : AppStrings.nowAgo,
                        ),
                        if (canConfirm) ...<Widget>[
                          const SizedBox(height: 12),
                          AppButton.secondary(
                            label: AppStrings.confirmButton,
                            onPressed: () => onConfirm?.call(report.id),
                          ),
                        ],
                      ],
                    ),
                  );
                },
                child: Icon(Icons.location_on, color: color, size: 30),
              ),
            );
          })
          .toList(growable: false),
    );
  }
}
