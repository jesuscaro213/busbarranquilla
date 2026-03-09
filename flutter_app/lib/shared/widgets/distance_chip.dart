import 'package:flutter/material.dart';

import '../../core/l10n/strings.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';

class DistanceChip extends StatelessWidget {
  final int meters;
  final String label;

  const DistanceChip({
    required this.meters,
    required this.label,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final color = AppColors.forDistance(meters);
    final suffix = meters > 600 ? ' ${AppStrings.distanceFar}' : '';

    return Text(
      '$meters ${AppStrings.distanceUnitMeters} $label$suffix',
      style: AppTextStyles.body.copyWith(color: color),
    );
  }
}
