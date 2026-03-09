import 'package:dio/dio.dart';

import '../../error/app_error.dart';

AppError mappedErrorFromDio(DioException e) {
  return e.requestOptions.extra['appError'] as AppError? ?? const UnknownError();
}

Map<String, dynamic> asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }
  return <String, dynamic>{};
}

Map<String, dynamic> mapAt(Map<String, dynamic> data, String key) {
  return asMap(data[key]);
}

List<Map<String, dynamic>> listAt(Map<String, dynamic> data, String key) {
  final raw = data[key];
  if (raw is! List) return const <Map<String, dynamic>>[];
  return raw.map<Map<String, dynamic>>((item) => asMap(item)).toList(growable: false);
}

String stringAt(Map<String, dynamic> data, String key) {
  final value = data[key];
  if (value is String) return value;
  if (value == null) return '';
  return value.toString();
}

int intAt(Map<String, dynamic> data, String key) {
  final value = data[key];
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value) ?? 0;
  return 0;
}
