import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/analytics/analytics_service.dart';
import '../../../core/data/repositories/payments_repository.dart';
import '../../../core/domain/models/user.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';

class PremiumCard extends ConsumerWidget {
  final User user;

  const PremiumCard({
    required this.user,
    super.key,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (user.hasActivePremium) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.success.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.success),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const Text(
              AppStrings.premiumAlready,
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            if (user.premiumExpiresAt != null) ...<Widget>[
              const SizedBox(height: 6),
              Text('${AppStrings.premiumExpiresLabel}: ${user.premiumExpiresAt!.formatDate()}'),
            ],
            const SizedBox(height: 12),
            AppButton.secondary(
              label: AppStrings.premiumViewBenefits,
              onPressed: () {
                AppBottomSheet.show<void>(
                  context,
                  title: AppStrings.premiumBenefitsTitle,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      for (final feature in AppStrings.premiumFeatures) ...<Widget>[
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Icon(Icons.check_circle, color: AppColors.success, size: 18),
                            const SizedBox(width: 10),
                            Expanded(child: Text(feature)),
                          ],
                        ),
                        const SizedBox(height: 10),
                      ],
                      if (user.premiumExpiresAt != null) ...<Widget>[
                        const Divider(),
                        const SizedBox(height: 8),
                        Text(
                          '${AppStrings.premiumActiveUntil}: ${user.premiumExpiresAt!.formatDate()}',
                          style: const TextStyle(
                            color: AppColors.success,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Text(
            AppStrings.premiumTitle,
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          for (final feature in AppStrings.premiumFeatures) ...<Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Icon(Icons.check_circle_rounded, color: AppColors.primary, size: 18),
                const SizedBox(width: 8),
                Expanded(child: Text(feature, style: const TextStyle(fontSize: 13))),
              ],
            ),
            const SizedBox(height: 6),
          ],
          const SizedBox(height: 12),
          AppButton.primary(
            label: AppStrings.premiumSubscribe,
            onPressed: () async {
              final result = await ref
                  .read(paymentsRepositoryProvider)
                  .createCheckout(AppStrings.premiumMonthlyPlanId);
              if (result is Failure<String>) {
                if (context.mounted) {
                  AppSnackbar.show(context, result.error.message, SnackbarType.error);
                }
                return;
              }

              final url = (result as Success<String>).data;
              final uri = Uri.tryParse(url);
              if (uri == null || !context.mounted) {
                return;
              }

              unawaited(AnalyticsService.premiumCheckoutStarted());
              final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
              if (!launched && context.mounted) {
                AppSnackbar.show(context, AppStrings.errorUnknown, SnackbarType.error);
              }
            },
          ),
        ],
      ),
    );
  }
}
