import '../../../core/domain/models/credit_transaction.dart';
import '../../../core/domain/models/user.dart';

sealed class ProfileState {
  const ProfileState();
}

final class ProfileLoading extends ProfileState {
  const ProfileLoading();
}

final class ProfileReady extends ProfileState {
  final User user;
  final int balance;
  final List<CreditTransaction> recentTransactions;
  final bool hasMore;
  final bool isLoadingMore;

  const ProfileReady({
    required this.user,
    required this.balance,
    required this.recentTransactions,
    this.hasMore = true,
    this.isLoadingMore = false,
  });

  ProfileReady copyWith({
    User? user,
    int? balance,
    List<CreditTransaction>? recentTransactions,
    bool? hasMore,
    bool? isLoadingMore,
  }) {
    return ProfileReady(
      user: user ?? this.user,
      balance: balance ?? this.balance,
      recentTransactions: recentTransactions ?? this.recentTransactions,
      hasMore: hasMore ?? this.hasMore,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    );
  }
}

final class ProfileError extends ProfileState {
  final String message;

  const ProfileError(this.message);
}
