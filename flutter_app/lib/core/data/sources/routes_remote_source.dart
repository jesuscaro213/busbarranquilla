import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class RoutesRemoteSource {
  final Dio _dio;

  const RoutesRemoteSource(this._dio);

  Future<Map<String, dynamic>> list({String? type}) async {
    final response = await _dio.get(
      ApiPaths.routes,
      queryParameters: type == null ? null : <String, dynamic>{'type': type},
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getById(int id) async {
    final response = await _dio.get(ApiPaths.routeById(id));
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> nearby({
    required double lat,
    required double lng,
    double radius = 0.5,
  }) async {
    final response = await _dio.get(
      ApiPaths.routesNearby,
      queryParameters: <String, dynamic>{
        'lat': lat,
        'lng': lng,
        'radius': radius,
      },
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> activeFeed() async {
    final response = await _dio.get(ApiPaths.routesActiveFeed);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> plan({
    required double destLat,
    required double destLng,
    double? originLat,
    double? originLng,
  }) async {
    final response = await _dio.get(
      ApiPaths.routesPlan,
      queryParameters: <String, dynamic>{
        'destLat': destLat,
        'destLng': destLng,
        if (originLat != null) 'originLat': originLat,
        if (originLng != null) 'originLng': originLng,
      },
    );

    return response.data as Map<String, dynamic>;
  }
}
