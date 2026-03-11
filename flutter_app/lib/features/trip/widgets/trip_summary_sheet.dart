import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';

class TripSummarySheet extends StatelessWidget {
  final String routeName;
  final String durationText;
  final int creditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final VoidCallback onClose;

  const TripSummarySheet({
    required this.routeName,
    required this.durationText,
    required this.creditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.onClose,
    super.key,
  });

  String get _distanceText {
    if (distanceMeters >= 1000) {
      return '${(distanceMeters / 1000).toStringAsFixed(1)} ${AppStrings.tripKmSuffix}';
    }
    return '$distanceMeters ${AppStrings.tripMetersSuffix}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(routeName, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        _Row(label: AppStrings.tripDurationLabel, value: durationText),
        const SizedBox(height: 6),
        _Row(label: AppStrings.tripDistanceLabel, value: _distanceText),
        const SizedBox(height: 6),
        _Row(
          label: AppStrings.tripCreditsLabel,
          value: '+$creditsEarned',
          valueColor: AppColors.success,
        ),
        if (completionBonusEarned) ...<Widget>[
          const SizedBox(height: 4),
          const Text(
            AppStrings.tripCompletionBonus,
            style: TextStyle(color: AppColors.success, fontSize: 12),
          ),
        ],
        if (!completionBonusEarned && distanceMeters < 2000) ...<Widget>[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.amber.shade50,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.amber.shade300),
            ),
            child: const Text(
              AppStrings.tripShortDistance,
              style: TextStyle(fontSize: 12),
            ),
          ),
        ],
        const SizedBox(height: 16),
        AppButton.primary(label: AppStrings.tripClose, onPressed: onClose),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _Row({required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: <Widget>[
        Text(label),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: valueColor,
          ),
        ),
      ],
    );
  }
}
