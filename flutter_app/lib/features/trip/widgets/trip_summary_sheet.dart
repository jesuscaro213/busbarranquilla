import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../shared/widgets/app_button.dart';

class TripSummarySheet extends StatelessWidget {
  final String routeName;
  final String durationText;
  final int creditsEarned;
  final VoidCallback onClose;

  const TripSummarySheet({
    required this.routeName,
    required this.durationText,
    required this.creditsEarned,
    required this.onClose,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(routeName, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        Text('${AppStrings.tripDurationLabel}: $durationText'),
        const SizedBox(height: 6),
        Text('${AppStrings.tripCreditsLabel}: $creditsEarned'),
        const SizedBox(height: 16),
        AppButton.primary(
          label: AppStrings.tripClose,
          onPressed: onClose,
        ),
      ],
    );
  }
}
