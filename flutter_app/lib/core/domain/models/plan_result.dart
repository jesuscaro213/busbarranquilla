import 'package:latlong2/latlong.dart';

import 'model_parsers.dart';

class PlanResult {
  final int id;
  final String name;
  final String code;
  final String? companyName;
  final String? nearestStopName;
  final LatLng nearestStop;
  final int distanceMeters;
  final int? originDistanceMeters;
  final int? frequencyMinutes;
  final List<LatLng> geometry;

  const PlanResult({
    required this.id,
    required this.name,
    required this.code,
    this.companyName,
    this.nearestStopName,
    required this.nearestStop,
    required this.distanceMeters,
    this.originDistanceMeters,
    this.frequencyMinutes,
    this.geometry = const <LatLng>[],
  });

  factory PlanResult.fromJson(Map<String, dynamic> json) {
    return PlanResult(
      id: asInt(json['id']),
      name: asString(json['name']),
      code: asString(json['code']),
      companyName: asStringOrNull(json['company_name']),
      nearestStopName: asStringOrNull(json['nearest_stop_name']),
      nearestStop: LatLng(
        asDouble(json['nearest_stop_lat']),
        asDouble(json['nearest_stop_lng']),
      ),
      distanceMeters: asInt(json['distance_meters']),
      originDistanceMeters: asIntOrNull(json['origin_distance_meters']),
      frequencyMinutes: asIntOrNull(json['frequency_minutes']),
      geometry: asLatLngList(json['geometry']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      'code': code,
      'company_name': companyName,
      'nearest_stop_name': nearestStopName,
      'nearest_stop_lat': nearestStop.latitude,
      'nearest_stop_lng': nearestStop.longitude,
      'distance_meters': distanceMeters,
      'origin_distance_meters': originDistanceMeters,
      'frequency_minutes': frequencyMinutes,
      'geometry': geometry.map((LatLng p) => <double>[p.latitude, p.longitude]).toList(growable: false),
    };
  }

  PlanResult copyWith({
    int? id,
    String? name,
    String? code,
    String? companyName,
    String? nearestStopName,
    LatLng? nearestStop,
    int? distanceMeters,
    int? originDistanceMeters,
    int? frequencyMinutes,
    List<LatLng>? geometry,
  }) {
    return PlanResult(
      id: id ?? this.id,
      name: name ?? this.name,
      code: code ?? this.code,
      companyName: companyName ?? this.companyName,
      nearestStopName: nearestStopName ?? this.nearestStopName,
      nearestStop: nearestStop ?? this.nearestStop,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      originDistanceMeters: originDistanceMeters ?? this.originDistanceMeters,
      frequencyMinutes: frequencyMinutes ?? this.frequencyMinutes,
      geometry: geometry ?? this.geometry,
    );
  }
}
