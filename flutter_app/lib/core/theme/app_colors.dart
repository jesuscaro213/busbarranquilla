import 'package:flutter/material.dart';

abstract final class AppColors {
  static const primary = Color(0xFF2563EB);
  static const primaryDark = Color(0xFF1E3A5F);
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const error = Color(0xFFEF4444);
  static const background = Color(0xFFF9FAFB);
  static const surface = Color(0xFFFFFFFF);
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF6B7280);
  static const divider = Color(0xFFE5E7EB);

  static const routeA = Color(0xFF3B82F6);
  static const routeB = Color(0xFF10B981);
  static const routeC = Color(0xFFF97316);
  static const routeD = Color(0xFF8B5CF6);
  static const routeDefault = Color(0xFF6B7280);

  static Color forRouteCode(String code) {
    if (code.isEmpty) return routeDefault;

    return switch (code[0].toUpperCase()) {
      'A' => routeA,
      'B' => routeB,
      'C' => routeC,
      'D' => routeD,
      _ => routeDefault,
    };
  }

  static Color forDistance(int meters) {
    if (meters <= 300) return success;
    if (meters <= 600) return warning;
    return error;
  }
}
