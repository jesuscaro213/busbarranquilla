import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/domain/models/user.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../auth/providers/auth_notifier.dart';
import '../providers/profile_notifier.dart';
import '../providers/profile_state.dart';
import '../widgets/premium_card.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  Color _roleColor(String role) {
    return switch (role) {
      'admin' => AppColors.primaryDark,
      'premium' => AppColors.success,
      _ => AppColors.textSecondary,
    };
  }

  String _trialUntilText(DateTime date) {
    final dd = date.day.toString().padLeft(2, '0');
    final mm = date.month.toString().padLeft(2, '0');
    return '$dd/$mm';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(profileNotifierProvider);

    if (state is ProfileLoading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (state is ProfileError) {
      return ErrorView(
        message: state.message,
        onRetry: () => ref.read(profileNotifierProvider.notifier).load(),
      );
    }

    final ready = state as ProfileReady;
    final trialText = ready.user.trialExpiresAt != null &&
            ready.user.trialExpiresAt!.isAfter(DateTime.now())
        ? _trialUntilText(ready.user.trialExpiresAt!)
        : null;

    return _ProfileReadyView(
      state: ready,
      roleColor: _roleColor(ready.user.role),
      trialText: trialText,
    );
  }
}

class _ProfileReadyView extends ConsumerWidget {
  final ProfileReady state;
  final Color roleColor;
  final String? trialText;

  const _ProfileReadyView({
    required this.state,
    required this.roleColor,
    required this.trialText,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final User user = state.user;

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.tabProfile)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(user.name, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(user.email),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  _Chip(
                    label: user.role,
                    color: roleColor,
                  ),
                  if (user.hasActivePremium)
                    _Chip(
                      label: user.premiumExpiresAt != null
                          ? '${AppStrings.premiumChipActive} ${user.premiumExpiresAt!.formatDate()}'
                          : AppStrings.premiumChipActive,
                      color: AppColors.success,
                    ),
                  if (trialText != null)
                    _Chip(
                      label: '${AppStrings.trialUntilLabel} $trialText',
                      color: AppColors.primary,
                    ),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.divider),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      '${state.balance}',
                      style: Theme.of(context).textTheme.displaySmall,
                    ),
                    const Text(AppStrings.creditsLabel),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => context.go('/profile/credits'),
                  child: const Text(AppStrings.viewHistory),
                ),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => context.go('/profile/trips'),
                  child: const Text(AppStrings.tripHistoryLink),
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.divider),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text(
                      AppStrings.referralCodeSection,
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    const SizedBox(height: 6),
                    if (user.referralCode != null) ...<Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              user.referralCode!,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 3,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.copy, size: 20),
                            onPressed: () async {
                              await Clipboard.setData(
                                ClipboardData(text: user.referralCode!),
                              );
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content: Text(AppStrings.referralCodeCopied),
                                    duration: Duration(seconds: 2),
                                  ),
                                );
                              }
                            },
                          ),
                        ],
                      ),
                      const Text(
                        AppStrings.referralCodeShare,
                        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                      ),
                    ] else
                      const Text(
                        AppStrings.referralCodeNone,
                        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              PremiumCard(user: user),
              const SizedBox(height: 20),
              AppButton.destructive(
                label: AppStrings.logoutLabel,
                onPressed: () async {
                  await ref.read(authNotifierProvider.notifier).logout();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;

  const _Chip({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
