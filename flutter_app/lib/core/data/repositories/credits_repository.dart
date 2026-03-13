import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/credit_transaction.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/credits_remote_source.dart';
import 'repository_helpers.dart';

class CreditsRepository {
  final CreditsRemoteSource _source;

  const CreditsRepository(this._source);

  Future<Result<CreditTransaction>> getBalance() async {
    try {
      final data = await _source.getBalance();
      final balanceAsTx = CreditTransaction.fromJson(<String, dynamic>{
        'id': 0,
        'user_id': 0,
        'amount': intAt(data, 'credits'),
        'type': 'balance',
        'description': null,
        'created_at': null,
      });
      return Success<CreditTransaction>(balanceAsTx);
    } on DioException catch (e) {
      return Failure<CreditTransaction>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<CreditTransaction>(UnknownError());
    }
  }

  Future<Result<List<CreditTransaction>>> getHistory({
    int limit = 20,
    int offset = 0,
  }) async {
    try {
      final data = await _source.getHistory(limit: limit, offset: offset);
      final transactions = listAt(data, 'transactions')
          .map(CreditTransaction.fromJson)
          .toList(growable: false);
      return Success<List<CreditTransaction>>(transactions);
    } on DioException catch (e) {
      return Failure<List<CreditTransaction>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<CreditTransaction>>(UnknownError());
    }
  }

  Future<Result<void>> spend(Map<String, dynamic> body) async {
    try {
      await _source.spend(body);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }

  /// Returns the user's current report streak (days in a row with at least one report).
  Future<int> getReportStreak() async {
    try {
      final data = await _source.getStats();
      return intAt(data, 'report_streak');
    } catch (_) {
      return 0;
    }
  }
}

final creditsRepositoryProvider = Provider<CreditsRepository>((ref) {
  return CreditsRepository(CreditsRemoteSource(ref.read(dioProvider)));
});
