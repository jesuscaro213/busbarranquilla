import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class StopsRemoteSource {
  final Dio _dio;

  const StopsRemoteSource(this._dio);

  Future<Map<String, dynamic>> listByRoute(int routeId) async {
    final response = await _dio.get(ApiPaths.routeStops(routeId));
    return response.data as Map<String, dynamic>;
  }
}
