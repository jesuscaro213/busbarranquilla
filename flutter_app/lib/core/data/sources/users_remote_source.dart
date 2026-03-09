import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class UsersRemoteSource {
  final Dio _dio;

  const UsersRemoteSource(this._dio);

  Future<Map<String, dynamic>> getFavorites() async {
    final response = await _dio.get(ApiPaths.favorites);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> addFavorite(int routeId) async {
    final response = await _dio.post(
      ApiPaths.favorites,
      data: <String, dynamic>{'route_id': routeId},
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> removeFavorite(int routeId) async {
    final response = await _dio.delete(ApiPaths.favoriteById(routeId));
    return response.data as Map<String, dynamic>;
  }
}
