import 'model_parsers.dart';

class Report {
  final int id;
  final int? userId;
  final int? routeId;
  final String type;
  final double latitude;
  final double longitude;
  final String? description;
  final bool isActive;
  final int confirmations;
  final DateTime? createdAt;
  final DateTime? expiresAt;
  final DateTime? resolvedAt;
  final bool creditsAwardedToReporter;
  final double? distanceKm;
  final bool confirmedByMe;
  final bool isValid;
  final int? neededConfirmations;
  final int? activeUsers;

  const Report({
    required this.id,
    this.userId,
    this.routeId,
    required this.type,
    required this.latitude,
    required this.longitude,
    this.description,
    required this.isActive,
    required this.confirmations,
    this.createdAt,
    this.expiresAt,
    this.resolvedAt,
    required this.creditsAwardedToReporter,
    this.distanceKm,
    required this.confirmedByMe,
    required this.isValid,
    this.neededConfirmations,
    this.activeUsers,
  });

  factory Report.fromJson(Map<String, dynamic> json) {
    return Report(
      id: asInt(json['id']),
      userId: asIntOrNull(json['user_id']),
      routeId: asIntOrNull(json['route_id']),
      type: asString(json['type']),
      latitude: asDouble(json['latitude']),
      longitude: asDouble(json['longitude']),
      description: asStringOrNull(json['description']),
      isActive: asBool(json['is_active'], fallback: true),
      confirmations: asInt(json['confirmations']),
      createdAt: asDateTimeOrNull(json['created_at']),
      expiresAt: asDateTimeOrNull(json['expires_at']),
      resolvedAt: asDateTimeOrNull(json['resolved_at']),
      creditsAwardedToReporter: asBool(json['credits_awarded_to_reporter']),
      distanceKm: asDoubleOrNull(json['distance']),
      confirmedByMe: asBool(json['confirmed_by_me']),
      isValid: asBool(json['is_valid'], fallback: true),
      neededConfirmations: asIntOrNull(json['needed_confirmations']),
      activeUsers: asIntOrNull(json['active_users']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'user_id': userId,
      'route_id': routeId,
      'type': type,
      'latitude': latitude,
      'longitude': longitude,
      'description': description,
      'is_active': isActive,
      'confirmations': confirmations,
      'created_at': createdAt?.toIso8601String(),
      'expires_at': expiresAt?.toIso8601String(),
      'resolved_at': resolvedAt?.toIso8601String(),
      'credits_awarded_to_reporter': creditsAwardedToReporter,
      'distance': distanceKm,
      'confirmed_by_me': confirmedByMe,
      'is_valid': isValid,
      'needed_confirmations': neededConfirmations,
      'active_users': activeUsers,
    };
  }

  Report copyWith({
    int? id,
    int? userId,
    int? routeId,
    String? type,
    double? latitude,
    double? longitude,
    String? description,
    bool? isActive,
    int? confirmations,
    DateTime? createdAt,
    DateTime? expiresAt,
    DateTime? resolvedAt,
    bool? creditsAwardedToReporter,
    double? distanceKm,
    bool? confirmedByMe,
    bool? isValid,
    int? neededConfirmations,
    int? activeUsers,
  }) {
    return Report(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      routeId: routeId ?? this.routeId,
      type: type ?? this.type,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      description: description ?? this.description,
      isActive: isActive ?? this.isActive,
      confirmations: confirmations ?? this.confirmations,
      createdAt: createdAt ?? this.createdAt,
      expiresAt: expiresAt ?? this.expiresAt,
      resolvedAt: resolvedAt ?? this.resolvedAt,
      creditsAwardedToReporter: creditsAwardedToReporter ?? this.creditsAwardedToReporter,
      distanceKm: distanceKm ?? this.distanceKm,
      confirmedByMe: confirmedByMe ?? this.confirmedByMe,
      isValid: isValid ?? this.isValid,
      neededConfirmations: neededConfirmations ?? this.neededConfirmations,
      activeUsers: activeUsers ?? this.activeUsers,
    );
  }
}
