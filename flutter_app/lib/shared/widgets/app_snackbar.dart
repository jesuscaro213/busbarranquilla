import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

enum SnackbarType { success, error, info }

class AppSnackbar {
  static void show(
    BuildContext context,
    String message,
    SnackbarType type,
  ) {
    final Color backgroundColor = switch (type) {
      SnackbarType.success => AppColors.success,
      SnackbarType.error => AppColors.error,
      SnackbarType.info => AppColors.primaryDark,
    };

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: backgroundColor,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }
}
