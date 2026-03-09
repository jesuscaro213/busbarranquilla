import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/strings.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../providers/profile_notifier.dart';
import '../providers/profile_state.dart';
import '../widgets/credit_history_tile.dart';

class CreditsHistoryScreen extends ConsumerWidget {
  const CreditsHistoryScreen({super.key});

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

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.viewHistory)),
      body: SafeArea(
        child: ready.recentTransactions.isEmpty
            ? const EmptyView(
                icon: Icons.receipt_long,
                message: AppStrings.emptyState,
              )
            : ListView(
                children: <Widget>[
                  for (final tx in ready.recentTransactions) CreditHistoryTile(transaction: tx),
                  if (ready.hasMore)
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: AppButton.secondary(
                        label: AppStrings.loadMore,
                        isLoading: ready.isLoadingMore,
                        onPressed: ready.isLoadingMore
                            ? null
                            : () => ref.read(profileNotifierProvider.notifier).loadMore(),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
