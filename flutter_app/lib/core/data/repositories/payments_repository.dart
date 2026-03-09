import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/payment.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../sources/payments_remote_source.dart';
import 'repository_helpers.dart';

class PaymentsRepository {
  final PaymentsRemoteSource _source;

  const PaymentsRepository(this._source);

  Future<Result<List<Payment>>> getPlansAsPayments() async {
    try {
      final data = await _source.getPlans();
      final plans = listAt(data, 'plans');
      final payments = plans
          .map(
            (plan) => Payment.fromJson(<String, dynamic>{
              'id': 0,
              'user_id': null,
              'wompi_reference': '',
              'wompi_transaction_id': null,
              'plan': stringAt(plan, 'id'),
              'amount_cents': intAt(plan, 'price_cop') * 100,
              'currency': 'COP',
              'status': 'pending',
              'created_at': null,
              'updated_at': null,
            }),
          )
          .toList(growable: false);
      return Success<List<Payment>>(payments);
    } on DioException catch (e) {
      return Failure<List<Payment>>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<List<Payment>>(UnknownError());
    }
  }

  Future<Result<String>> createCheckout(String plan) async {
    try {
      final data = await _source.createCheckout(plan);
      return Success<String>(stringAt(data, 'checkout_url'));
    } on DioException catch (e) {
      return Failure<String>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<String>(UnknownError());
    }
  }
}

final paymentsRepositoryProvider = Provider<PaymentsRepository>((ref) {
  return PaymentsRepository(PaymentsRemoteSource(ref.read(dioProvider)));
});
