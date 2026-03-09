import 'package:flutter/material.dart';

import '../../../core/domain/models/credit_transaction.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/extensions/datetime_extensions.dart';

class CreditHistoryTile extends StatelessWidget {
  final CreditTransaction transaction;

  const CreditHistoryTile({
    required this.transaction,
    super.key,
  });

  bool get _isEarn {
    if (transaction.amount >= 0) return true;
    return transaction.type == 'earn' ||
        transaction.type == 'credit' ||
        transaction.type == 'reward' ||
        transaction.type == 'bonus';
  }

  @override
  Widget build(BuildContext context) {
    final isEarn = _isEarn;
    final color = isEarn ? AppColors.success : AppColors.error;
    final amount = transaction.amount.abs();

    return ListTile(
      leading: Icon(
        isEarn ? Icons.arrow_upward : Icons.arrow_downward,
        color: color,
      ),
      title: Text(transaction.description ?? transaction.type),
      subtitle: Text(transaction.createdAt?.formatDate() ?? AppStrings.notAvailable),
      trailing: Text(
        '${isEarn ? '+' : '-'}$amount',
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
