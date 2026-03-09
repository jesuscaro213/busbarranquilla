import 'model_parsers.dart';

class Stop {
  final int id;
  final int routeId;
  final String name;
  final double latitude;
  final double longitude;
  final int stopOrder;
  final String? leg;
  final DateTime? createdAt;

  const Stop({
    required this.id,
    required this.routeId,
    required this.name,
    required this.latitude,
    required this.longitude,
    required this.stopOrder,
    this.leg,
    this.createdAt,
  });

  factory Stop.fromJson(Map<String, dynamic> json) {
    return Stop(
      id: asInt(json['id']),
      routeId: asInt(json['route_id']),
      name: asString(json['name']),
      latitude: asDouble(json['latitude']),
      longitude: asDouble(json['longitude']),
      stopOrder: asInt(json['stop_order']),
      leg: asStringOrNull(json['leg']),
      createdAt: asDateTimeOrNull(json['created_at']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'route_id': routeId,
      'name': name,
      'latitude': latitude,
      'longitude': longitude,
      'stop_order': stopOrder,
      'leg': leg,
      'created_at': createdAt?.toIso8601String(),
    };
  }

  Stop copyWith({
    int? id,
    int? routeId,
    String? name,
    double? latitude,
    double? longitude,
    int? stopOrder,
    String? leg,
    DateTime? createdAt,
  }) {
    return Stop(
      id: id ?? this.id,
      routeId: routeId ?? this.routeId,
      name: name ?? this.name,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      stopOrder: stopOrder ?? this.stopOrder,
      leg: leg ?? this.leg,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
