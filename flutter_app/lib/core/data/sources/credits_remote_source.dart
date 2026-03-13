import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class CreditsRemoteSource {
  final Dio _dio;

  const CreditsRemoteSource(this._dio);

  Future<Map<String, dynamic>> getBalance() async {
    final response = await _dio.get(ApiPaths.creditsBalance);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getHistory({int limit = 20, int offset = 0}) async {
    final response = await _dio.get(
      ApiPaths.creditsHistory,
      queryParameters: <String, dynamic>{
        'limit': limit,
        'offset': offset,
      },
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> spend(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.creditsSpend, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getStats() async {
    final response = await _dio.get(ApiPaths.creditsStats);
    return response.data as Map<String, dynamic>;
  }
}
