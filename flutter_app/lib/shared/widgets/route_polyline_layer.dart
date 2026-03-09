import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../core/theme/app_colors.dart';

class RoutePolylineLayer extends StatelessWidget {
  final List<LatLng> points;
  final Color color;
  final double strokeWidth;

  const RoutePolylineLayer({
    required this.points,
    this.color = AppColors.primary,
    this.strokeWidth = 4,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return PolylineLayer(
      polylines: <Polyline>[
        Polyline(
          points: points,
          color: color,
          strokeWidth: strokeWidth,
        ),
      ],
    );
  }
}
