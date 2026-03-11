import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/domain/models/plan_result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/distance_chip.dart';
import '../../../shared/widgets/route_activity_badge.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../providers/favorites_provider.dart';

class PlanResultCard extends ConsumerWidget {
  final PlanResult result;
  final VoidCallback onSelect;

  const PlanResultCard({
    required this.result,
    required this.onSelect,
    super.key,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isFavorite = ref.watch(favoritesProvider).valueOrNull?.any((r) => r.id == result.id) ?? false;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onSelect,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  RouteCodeBadge(code: result.code),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(result.name, style: Theme.of(context).textTheme.titleMedium),
                        if ((result.companyName ?? '').isNotEmpty)
                          Text(result.companyName!, style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () async {
                      final notifier = ref.read(favoritesProvider.notifier);
                      if (isFavorite) {
                        await notifier.removeFavorite(result.id);
                      } else {
                        await notifier.addFavorite(result.id);
                      }
                    },
                    icon: Icon(
                      isFavorite ? Icons.favorite : Icons.favorite_border,
                      color: isFavorite ? AppColors.error : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (result.originDistanceMeters != null)
                DistanceChip(
                  meters: result.originDistanceMeters!,
                  label: AppStrings.distanceOriginLabel,
                ),
              DistanceChip(
                meters: result.distanceMeters,
                label: AppStrings.distanceDestLabel,
              ),
              const SizedBox(height: 6),
              Text(result.nearestStopName ?? AppStrings.notAvailable),
              if (result.frequencyMinutes != null)
                Text('${AppStrings.frequencyLabel}: ${result.frequencyMinutes} ${AppStrings.timeUnitMinutes}'),
              const SizedBox(height: 6),
              RouteActivityBadge(routeId: result.id),
            ],
          ),
        ),
      ),
    );
  }
}
