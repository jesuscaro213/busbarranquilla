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

  Future<Map<String, dynamic>> getActivity(int id) async {
    final response = await _dio.get(ApiPaths.routeActivity(id));
    return response.data as Map<String, dynamic>;
  }

  /// Returns the raw response map so callers can inspect `on_route`.
  Future<Map<String, dynamic>> reportRouteUpdate(
    int routeId,
    String tipo, {
    double? lat,
    double? lng,
  }) async {
    final body = <String, dynamic>{'tipo': tipo};
    if (lat != null) body['lat'] = lat;
    if (lng != null) body['lng'] = lng;
    final response = await _dio.post(ApiPaths.routeUpdateReport(routeId), data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<void> updateDeviationReEntry(int routeId, double lat, double lng) async {
    await _dio.patch(
      ApiPaths.routeUpdateReEntry(routeId),
      data: <String, dynamic>{'lat': lat, 'lng': lng},
    );
  }
}
