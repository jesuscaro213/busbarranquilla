import 'model_parsers.dart';

class ActiveTrip {
  final int id;
  final int? userId;
  final int? routeId;
  final String? routeName;
  final String? routeCode;
  final double? currentLatitude;
  final double? currentLongitude;
  final int? destinationStopId;
  final double? destinationLat;
  final double? destinationLng;
  final String? destinationStopName;
  final DateTime? startedAt;
  final DateTime? lastLocationAt;
  final DateTime? endedAt;
  final int creditsEarned;
  final bool isActive;

  const ActiveTrip({
    required this.id,
    this.userId,
    this.routeId,
    this.routeName,
    this.routeCode,
    this.currentLatitude,
    this.currentLongitude,
    this.destinationStopId,
    this.destinationLat,
    this.destinationLng,
    this.destinationStopName,
    this.startedAt,
    this.lastLocationAt,
    this.endedAt,
    required this.creditsEarned,
    required this.isActive,
  });

  factory ActiveTrip.fromJson(Map<String, dynamic> json) {
    return ActiveTrip(
      id: asInt(json['id']),
      userId: asIntOrNull(json['user_id']),
      routeId: asIntOrNull(json['route_id']),
      routeName: asStringOrNull(json['route_name']),
      routeCode: asStringOrNull(json['route_code']),
      currentLatitude: asDoubleOrNull(json['current_latitude']),
      currentLongitude: asDoubleOrNull(json['current_longitude']),
      destinationStopId: asIntOrNull(json['destination_stop_id']),
      destinationLat: asDoubleOrNull(json['destination_lat']),
      destinationLng: asDoubleOrNull(json['destination_lng']),
      destinationStopName: asStringOrNull(json['destination_stop_name']),
      startedAt: asDateTimeOrNull(json['started_at']),
      lastLocationAt: asDateTimeOrNull(json['last_location_at']),
      endedAt: asDateTimeOrNull(json['ended_at']),
      creditsEarned: asInt(json['credits_earned']),
      isActive: asBool(json['is_active'], fallback: true),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'user_id': userId,
      'route_id': routeId,
      'route_name': routeName,
      'route_code': routeCode,
      'current_latitude': currentLatitude,
      'current_longitude': currentLongitude,
      'destination_stop_id': destinationStopId,
      'destination_lat': destinationLat,
      'destination_lng': destinationLng,
      'destination_stop_name': destinationStopName,
      'started_at': startedAt?.toIso8601String(),
      'last_location_at': lastLocationAt?.toIso8601String(),
      'ended_at': endedAt?.toIso8601String(),
      'credits_earned': creditsEarned,
      'is_active': isActive,
    };
  }

  ActiveTrip copyWith({
    int? id,
    int? userId,
    int? routeId,
    String? routeName,
    String? routeCode,
    double? currentLatitude,
    double? currentLongitude,
    int? destinationStopId,
    double? destinationLat,
    double? destinationLng,
    String? destinationStopName,
    DateTime? startedAt,
    DateTime? lastLocationAt,
    DateTime? endedAt,
    int? creditsEarned,
    bool? isActive,
  }) {
    return ActiveTrip(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      routeId: routeId ?? this.routeId,
      routeName: routeName ?? this.routeName,
      routeCode: routeCode ?? this.routeCode,
      currentLatitude: currentLatitude ?? this.currentLatitude,
      currentLongitude: currentLongitude ?? this.currentLongitude,
      destinationStopId: destinationStopId ?? this.destinationStopId,
      destinationLat: destinationLat ?? this.destinationLat,
      destinationLng: destinationLng ?? this.destinationLng,
      destinationStopName: destinationStopName ?? this.destinationStopName,
      startedAt: startedAt ?? this.startedAt,
      lastLocationAt: lastLocationAt ?? this.lastLocationAt,
      endedAt: endedAt ?? this.endedAt,
      creditsEarned: creditsEarned ?? this.creditsEarned,
      isActive: isActive ?? this.isActive,
    );
  }
}
