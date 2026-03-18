import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';

enum _ButtonVariant { primary, secondary, destructive }

class AppButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final _ButtonVariant _variant;

  const AppButton.primary({
    required this.label,
    this.onPressed,
    this.isLoading = false,
    super.key,
  }) : _variant = _ButtonVariant.primary;

  const AppButton.secondary({
    required this.label,
    this.onPressed,
    this.isLoading = false,
    super.key,
  }) : _variant = _ButtonVariant.secondary;

  const AppButton.outlined({
    required this.label,
    this.onPressed,
    this.isLoading = false,
    super.key,
  }) : _variant = _ButtonVariant.secondary;

  const AppButton.destructive({
    required this.label,
    this.onPressed,
    this.isLoading = false,
    super.key,
  }) : _variant = _ButtonVariant.destructive;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || isLoading;

    final Color backgroundColor = switch (_variant) {
      _ButtonVariant.primary => AppColors.primary,
      _ButtonVariant.secondary => AppColors.surface,
      _ButtonVariant.destructive => AppColors.error,
    };

    final Color foregroundColor = switch (_variant) {
      _ButtonVariant.primary => AppColors.surface,
      _ButtonVariant.secondary => AppColors.textPrimary,
      _ButtonVariant.destructive => AppColors.surface,
    };

    final BorderSide side = switch (_variant) {
      _ButtonVariant.secondary => const BorderSide(color: AppColors.divider),
      _ => BorderSide.none,
    };

    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: disabled ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: backgroundColor,
          foregroundColor: foregroundColor,
          disabledBackgroundColor: backgroundColor.withValues(alpha: 0.55),
          disabledForegroundColor: foregroundColor.withValues(alpha: 0.75),
          textStyle: AppTextStyles.button,
          side: side,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
        ),
        child: isLoading
            ? SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(foregroundColor),
                ),
              )
            : Text(label),
      ),
    );
  }
}
