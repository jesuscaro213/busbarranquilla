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
      width: 62,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.forRouteCode(code),
        borderRadius: BorderRadius.circular(6),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          code,
          maxLines: 2,
          textAlign: TextAlign.center,
          style: AppTextStyles.badge,
        ),
      ),
    );
  }
}
