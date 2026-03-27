import 'package:latlong2/latlong.dart';

import 'model_parsers.dart';

class PlanResult {
  final int id;
  final String name;
  final String code;
  final String? companyName;
  final int? nearestStopId;
  final String? nearestStopName;
  final String? nearestStopAddress;
  final int? turnaroundIdx;
  final LatLng nearestStop;
  final double? projectedLat;
  final double? projectedLng;
  final int distanceMeters;
  final int? originDistanceMeters;
  final int? frequencyMinutes;
  final List<LatLng> geometry;

  const PlanResult({
    required this.id,
    required this.name,
    required this.code,
    this.companyName,
    this.nearestStopId,
    this.nearestStopName,
    this.nearestStopAddress,
    this.turnaroundIdx,
    required this.nearestStop,
    this.projectedLat,
    this.projectedLng,
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
      nearestStopId: asIntOrNull(json['nearest_stop_id']),
      nearestStopName: asStringOrNull(json['nearest_stop_name']),
      nearestStopAddress: asStringOrNull(json['nearest_stop_address']),
      turnaroundIdx: asIntOrNull(json['turnaround_idx']),
      nearestStop: LatLng(
        asDouble(json['nearest_stop_lat']),
        asDouble(json['nearest_stop_lng']),
      ),
      projectedLat: asDoubleOrNull(json['projected_lat']),
      projectedLng: asDoubleOrNull(json['projected_lng']),
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
      'nearest_stop_id': nearestStopId,
      'nearest_stop_name': nearestStopName,
      'nearest_stop_address': nearestStopAddress,
      'turnaround_idx': turnaroundIdx,
      'nearest_stop_lat': nearestStop.latitude,
      'nearest_stop_lng': nearestStop.longitude,
      'projected_lat': projectedLat,
      'projected_lng': projectedLng,
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
    int? nearestStopId,
    String? nearestStopName,
    String? nearestStopAddress,
    int? turnaroundIdx,
    LatLng? nearestStop,
    double? projectedLat,
    double? projectedLng,
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
      nearestStopId: nearestStopId ?? this.nearestStopId,
      nearestStopName: nearestStopName ?? this.nearestStopName,
      nearestStopAddress: nearestStopAddress ?? this.nearestStopAddress,
      turnaroundIdx: turnaroundIdx ?? this.turnaroundIdx,
      nearestStop: nearestStop ?? this.nearestStop,
      projectedLat: projectedLat ?? this.projectedLat,
      projectedLng: projectedLng ?? this.projectedLng,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      originDistanceMeters: originDistanceMeters ?? this.originDistanceMeters,
      frequencyMinutes: frequencyMinutes ?? this.frequencyMinutes,
      geometry: geometry ?? this.geometry,
    );
  }
}
