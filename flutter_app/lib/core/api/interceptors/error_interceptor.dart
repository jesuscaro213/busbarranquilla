import 'package:dio/dio.dart';

import '../../error/app_error.dart';
import '../../l10n/strings.dart';

class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final appError = _mapDioError(err);
    err.requestOptions.extra['appError'] = appError;
    handler.next(err);
  }

  AppError _mapDioError(DioException e) {
    if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout) {
      return const NetworkError();
    }

    final status = e.response?.statusCode;
    final payload = e.response?.data;
    final serverMessage = payload is Map<String, dynamic> ? payload['message'] as String? : null;

    if (status == 401) {
      return AuthError(serverMessage ?? AppStrings.errorUnknown);
    }

    if (status != null) {
      return ServerError(serverMessage ?? AppStrings.errorServer, status);
    }

    return const UnknownError();
  }
}
