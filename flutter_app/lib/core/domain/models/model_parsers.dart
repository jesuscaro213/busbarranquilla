import 'package:latlong2/latlong.dart';

int? asIntOrNull(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

int asInt(dynamic value, {int fallback = 0}) => asIntOrNull(value) ?? fallback;

double? asDoubleOrNull(dynamic value) {
  if (value == null) return null;
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

double asDouble(dynamic value, {double fallback = 0}) => asDoubleOrNull(value) ?? fallback;

String? asStringOrNull(dynamic value) {
  if (value == null) return null;
  if (value is String) {
    if (value.trim().isEmpty) return null;
    return value;
  }
  return value.toString();
}

String asString(dynamic value, {String fallback = ''}) => asStringOrNull(value) ?? fallback;

bool? asBoolOrNull(dynamic value) {
  if (value == null) return null;
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    final normalized = value.trim().toLowerCase();
    if (normalized == 'true' || normalized == '1') return true;
    if (normalized == 'false' || normalized == '0') return false;
  }
  return null;
}

bool asBool(dynamic value, {bool fallback = false}) => asBoolOrNull(value) ?? fallback;

DateTime? asDateTimeOrNull(dynamic value) {
  if (value == null) return null;
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}

DateTime asDateTime(dynamic value) =>
    asDateTimeOrNull(value) ?? DateTime.fromMillisecondsSinceEpoch(0);

List<LatLng> asLatLngList(dynamic rawGeometry) {
  if (rawGeometry is! List) return const <LatLng>[];

  return rawGeometry
      .whereType<List<dynamic>>()
      .map((point) {
        final lat = point.isNotEmpty ? asDoubleOrNull(point[0]) : null;
        final lng = point.length > 1 ? asDoubleOrNull(point[1]) : null;
        if (lat == null || lng == null) return null;
        return LatLng(lat, lng);
      })
      .whereType<LatLng>()
      .toList(growable: false);
}
