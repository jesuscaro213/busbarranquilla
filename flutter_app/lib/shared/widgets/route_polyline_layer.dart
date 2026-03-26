import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/app_colors.dart';

class RoutePolylineLayer extends StatelessWidget {
  final List<LatLng> points;
  final Color color;
  final double strokeWidth;
  /// When provided, splits the geometry at this index:
  /// [0..turnaroundIdx] is drawn in [color] (ida),
  /// [turnaroundIdx..] is drawn in [regresoColor] (regreso).
  final int? turnaroundIdx;
  final Color regresoColor;

  const RoutePolylineLayer({
    required this.points,
    this.color = AppColors.primary,
    this.strokeWidth = 4,
    this.turnaroundIdx,
    this.regresoColor = AppColors.routeC,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final int? split = turnaroundIdx;
    if (split == null || split <= 0 || split >= points.length) {
      return PolylineLayer(
        polylines: <Polyline>[
          Polyline(points: points, color: color, strokeWidth: strokeWidth),
        ],
      );
    }

    final List<LatLng> idaPoints = points.sublist(0, split + 1);
    final List<LatLng> regresoPoints = points.sublist(split);

    return PolylineLayer(
      polylines: <Polyline>[
        Polyline(points: idaPoints, color: color, strokeWidth: strokeWidth),
        Polyline(points: regresoPoints, color: regresoColor, strokeWidth: strokeWidth),
      ],
    );
  }
}
