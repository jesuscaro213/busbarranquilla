import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class PaymentsRemoteSource {
  final Dio _dio;

  const PaymentsRemoteSource(this._dio);

  Future<Map<String, dynamic>> getPlans() async {
    final response = await _dio.get(ApiPaths.paymentPlans);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> createCheckout(String plan) async {
    final response = await _dio.post(
      ApiPaths.paymentCheckout,
      data: <String, dynamic>{'plan': plan},
    );

    return response.data as Map<String, dynamic>;
  }
}
