import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';

class ReportCreateSheet extends StatelessWidget {
  final ValueChanged<String> onSelectType;

  const ReportCreateSheet({
    required this.onSelectType,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final entries = AppStrings.reportTypes.entries.toList(growable: false);

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 2.6,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
      ),
      itemCount: entries.length,
      itemBuilder: (_, index) {
        final entry = entries[index];
        return OutlinedButton(
          onPressed: () => onSelectType(entry.key),
          child: Text(entry.value, textAlign: TextAlign.center),
        );
      },
    );
  }
}
