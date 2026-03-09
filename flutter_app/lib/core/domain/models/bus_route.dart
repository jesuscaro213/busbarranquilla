import 'package:latlong2/latlong.dart';

import 'model_parsers.dart';

class BusRoute {
  final int id;
  final String name;
  final String code;
  final String? company;
  final String? companyName;
  final int? companyId;
  final String? firstDeparture;
  final String? lastDeparture;
  final int? frequencyMinutes;
  final bool isActive;
  final String? status;
  final String? type;
  final String? color;
  final int? turnaroundIdx;
  final double? minDistanceKm;
  final DateTime? lastReportAt;
  final String? lastReportType;
  final int? minutesAgo;
  final int? activeUsersCount;
  final bool? hasActiveUsers;
  final bool? hasRecentReport;
  final List<LatLng> geometry;

  const BusRoute({
    required this.id,
    required this.name,
    required this.code,
    this.company,
    this.companyName,
    this.companyId,
    this.firstDeparture,
    this.lastDeparture,
    this.frequencyMinutes,
    required this.isActive,
    this.status,
    this.type,
    this.color,
    this.turnaroundIdx,
    this.minDistanceKm,
    this.lastReportAt,
    this.lastReportType,
    this.minutesAgo,
    this.activeUsersCount,
    this.hasActiveUsers,
    this.hasRecentReport,
    this.geometry = const <LatLng>[],
  });

  factory BusRoute.fromJson(Map<String, dynamic> json) {
    return BusRoute(
      id: asInt(json['id']),
      name: asString(json['name']),
      code: asString(json['code']),
      company: asStringOrNull(json['company']),
      companyName: asStringOrNull(json['company_name']),
      companyId: asIntOrNull(json['company_id']),
      firstDeparture: asStringOrNull(json['first_departure']),
      lastDeparture: asStringOrNull(json['last_departure']),
      frequencyMinutes: asIntOrNull(json['frequency_minutes']),
      isActive: asBool(json['is_active'], fallback: true),
      status: asStringOrNull(json['status']),
      type: asStringOrNull(json['type']),
      color: asStringOrNull(json['color']),
      turnaroundIdx: asIntOrNull(json['turnaround_idx']),
      minDistanceKm: asDoubleOrNull(json['min_distance']),
      lastReportAt: asDateTimeOrNull(json['last_report_at']),
      lastReportType: asStringOrNull(json['last_report_type']),
      minutesAgo: asIntOrNull(json['minutes_ago']),
      activeUsersCount: asIntOrNull(json['active_users_count']),
      hasActiveUsers: asBoolOrNull(json['has_active_users']),
      hasRecentReport: asBoolOrNull(json['has_recent_report']),
      geometry: asLatLngList(json['geometry']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      'code': code,
      'company': company,
      'company_name': companyName,
      'company_id': companyId,
      'first_departure': firstDeparture,
      'last_departure': lastDeparture,
      'frequency_minutes': frequencyMinutes,
      'is_active': isActive,
      'status': status,
      'type': type,
      'color': color,
      'turnaround_idx': turnaroundIdx,
      'min_distance': minDistanceKm,
      'last_report_at': lastReportAt?.toIso8601String(),
      'last_report_type': lastReportType,
      'minutes_ago': minutesAgo,
      'active_users_count': activeUsersCount,
      'has_active_users': hasActiveUsers,
      'has_recent_report': hasRecentReport,
      'geometry': geometry.map((LatLng p) => <double>[p.latitude, p.longitude]).toList(growable: false),
    };
  }

  BusRoute copyWith({
    int? id,
    String? name,
    String? code,
    String? company,
    String? companyName,
    int? companyId,
    String? firstDeparture,
    String? lastDeparture,
    int? frequencyMinutes,
    bool? isActive,
    String? status,
    String? type,
    String? color,
    int? turnaroundIdx,
    double? minDistanceKm,
    DateTime? lastReportAt,
    String? lastReportType,
    int? minutesAgo,
    int? activeUsersCount,
    bool? hasActiveUsers,
    bool? hasRecentReport,
    List<LatLng>? geometry,
  }) {
    return BusRoute(
      id: id ?? this.id,
      name: name ?? this.name,
      code: code ?? this.code,
      company: company ?? this.company,
      companyName: companyName ?? this.companyName,
      companyId: companyId ?? this.companyId,
      firstDeparture: firstDeparture ?? this.firstDeparture,
      lastDeparture: lastDeparture ?? this.lastDeparture,
      frequencyMinutes: frequencyMinutes ?? this.frequencyMinutes,
      isActive: isActive ?? this.isActive,
      status: status ?? this.status,
      type: type ?? this.type,
      color: color ?? this.color,
      turnaroundIdx: turnaroundIdx ?? this.turnaroundIdx,
      minDistanceKm: minDistanceKm ?? this.minDistanceKm,
      lastReportAt: lastReportAt ?? this.lastReportAt,
      lastReportType: lastReportType ?? this.lastReportType,
      minutesAgo: minutesAgo ?? this.minutesAgo,
      activeUsersCount: activeUsersCount ?? this.activeUsersCount,
      hasActiveUsers: hasActiveUsers ?? this.hasActiveUsers,
      hasRecentReport: hasRecentReport ?? this.hasRecentReport,
      geometry: geometry ?? this.geometry,
    );
  }
}
