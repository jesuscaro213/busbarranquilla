import 'package:dio/dio.dart';

import '../../api/api_paths.dart';

class AuthRemoteSource {
  final Dio _dio;

  const AuthRemoteSource(this._dio);

  Future<Map<String, dynamic>> login(String email, String password) async {
    final response = await _dio.post(
      ApiPaths.login,
      data: <String, dynamic>{
        'email': email,
        'password': password,
      },
    );

    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> register(Map<String, dynamic> body) async {
    final response = await _dio.post(ApiPaths.register, data: body);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getProfile() async {
    final response = await _dio.get(ApiPaths.profile);
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> loginWithGoogle(String idToken) async {
    final response = await _dio.post(
      ApiPaths.authGoogle,
      data: <String, dynamic>{'idToken': idToken},
    );
    return response.data as Map<String, dynamic>;
  }
}
