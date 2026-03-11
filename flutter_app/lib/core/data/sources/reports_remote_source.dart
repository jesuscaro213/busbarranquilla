import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class ReportsRemoteSource {
  final Dio _dio;

  const ReportsRemoteSource(this._dio);

  Future<Map<String, dynamic>> getNearby({
    required double lat,
    required double lng,
    double radius = 1,
  }) async {
    final response = await _dio.get(
      ApiPaths.reportsNearby,
      queryParameters: <String, dynamic>{
        'lat': lat,
        'lng': lng,
        'radius': radius,
      },
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getRouteReports(int routeId) async {
    final response = await _dio.get(ApiPaths.routeReports(routeId));
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> create(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.reports, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> confirm(int reportId) async {
    final response = await _dio.put(ApiPaths.reportConfirm(reportId));
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> resolve(int reportId) async {
    final response = await _dio.patch(ApiPaths.reportResolve(reportId));
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getOccupancy(int routeId) async {
    final response = await _dio.get(ApiPaths.reportsOccupancy(routeId));
    return response.data as Map<String, dynamic>;
  }
}
