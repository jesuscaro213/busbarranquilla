import 'package:flutter/material.dart';

import '../../../core/domain/models/report.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/empty_view.dart';

class RouteReportsList extends StatelessWidget {
  final List<Report> reports;
  final ValueChanged<int> onConfirm;

  const RouteReportsList({
    required this.reports,
    required this.onConfirm,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    if (reports.isEmpty) {
      return const EmptyView(
        icon: Icons.report_gmailerrorred_outlined,
        message: AppStrings.tripNoReports,
      );
    }

    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: reports.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final report = reports[index];
        final label = AppStrings.reportTypes[report.type] ?? report.type;
        final icon = label.split(' ').first;
        final text = label.replaceFirst('$icon ', '');
        final timeText = report.createdAt?.timeAgo() ?? AppStrings.nowAgo;

        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: <Widget>[
              Text(icon),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(text),
                    Text(
                      timeText,
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 112,
                child: AppButton.secondary(
                  label: AppStrings.tripConfirm,
                  onPressed: () => onConfirm(report.id),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
