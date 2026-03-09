import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/credits_repository.dart';
import '../../../core/domain/models/credit_transaction.dart';
import '../../../core/domain/models/user.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../auth/providers/auth_notifier.dart';
import '../../auth/providers/auth_state.dart';
import 'profile_state.dart';

class ProfileNotifier extends Notifier<ProfileState> {
  static const int _pageSize = 20;
  bool _didInitialize = false;
  int _offset = 0;

  @override
  ProfileState build() {
    if (!_didInitialize) {
      _didInitialize = true;
      Future<void>(() => load());
    }
    return const ProfileLoading();
  }

  Future<void> load() async {
    state = const ProfileLoading();

    final user = _authUser;
    if (user == null) {
      state = const ProfileError(AppStrings.errorUnknown);
      return;
    }

    _offset = 0;

    final balanceResult = await ref.read(creditsRepositoryProvider).getBalance();
    if (balanceResult is Failure<CreditTransaction>) {
      state = ProfileError(balanceResult.error.message);
      return;
    }

    final historyResult = await ref.read(creditsRepositoryProvider).getHistory(
          limit: _pageSize,
          offset: _offset,
        );

    if (historyResult is Failure<List<CreditTransaction>>) {
      state = ProfileError(historyResult.error.message);
      return;
    }

    final balanceTx = (balanceResult as Success<CreditTransaction>).data;
    final history = (historyResult as Success<List<CreditTransaction>>).data;

    state = ProfileReady(
      user: user,
      balance: balanceTx.amount,
      recentTransactions: history,
      hasMore: history.length == _pageSize,
    );
  }

  Future<void> loadMore() async {
    if (state is! ProfileReady) return;

    final current = state as ProfileReady;
    if (!current.hasMore || current.isLoadingMore) return;

    state = current.copyWith(isLoadingMore: true);

    final nextOffset = _offset + _pageSize;
    final result = await ref.read(creditsRepositoryProvider).getHistory(
          limit: _pageSize,
          offset: nextOffset,
        );

    if (result is Failure<List<CreditTransaction>>) {
      state = current.copyWith(isLoadingMore: false);
      return;
    }

    final nextPage = (result as Success<List<CreditTransaction>>).data;
    _offset = nextOffset;

    state = current.copyWith(
      recentTransactions: <CreditTransaction>[
        ...current.recentTransactions,
        ...nextPage,
      ],
      hasMore: nextPage.length == _pageSize,
      isLoadingMore: false,
    );
  }

  User? get _authUser {
    final authState = ref.read(authNotifierProvider);
    return switch (authState) {
      Authenticated(user: final user) => user,
      _ => null,
    };
  }
}

final profileNotifierProvider = NotifierProvider<ProfileNotifier, ProfileState>(
  ProfileNotifier.new,
);
