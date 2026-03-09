import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_text_styles.dart';

class RouteCodeBadge extends StatelessWidget {
  final String code;

  const RouteCodeBadge({
    required this.code,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.forRouteCode(code),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        code,
        style: AppTextStyles.badge,
      ),
    );
  }
}
