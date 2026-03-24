import 'package:flutter/material.dart';

import '../../../core/domain/models/bus_route.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/route_code_badge.dart';

class ActiveFeedBar extends StatelessWidget {
  final List<BusRoute> activeFeedRoutes;
  final ValueChanged<BusRoute> onSelectRoute;

  const ActiveFeedBar({
    required this.activeFeedRoutes,
    required this.onSelectRoute,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    if (activeFeedRoutes.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: activeFeedRoutes.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final route = activeFeedRoutes[index];
          final minutesText = route.minutesAgo != null
              ? AppStrings.agoMinutes(route.minutesAgo!)
              : (route.lastReportAt != null ? route.lastReportAt!.timeAgo() : AppStrings.nowAgo);

          return GestureDetector(
            onTap: () => onSelectRoute(route),
            child: Container(
              width: 230,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: AppColors.textSecondary.withValues(alpha: 0.12),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  RouteCodeBadge(code: route.code),
                  const SizedBox(height: 8),
                  Text(route.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                  Text(
                    route.companyName ?? route.company ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                  const Spacer(),
                  Text(
                    minutesText,
                    style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
