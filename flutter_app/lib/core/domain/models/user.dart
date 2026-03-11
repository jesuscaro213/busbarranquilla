import 'model_parsers.dart';

class User {
  final int id;
  final String name;
  final String email;
  final String? phone;
  final int credits;
  final String role;
  final bool isPremium;
  final bool isActive;
  final DateTime? trialExpiresAt;
  final DateTime? premiumExpiresAt;
  final int reputation;
  final DateTime? createdAt;
  final String? referralCode;

  const User({
    required this.id,
    required this.name,
    required this.email,
    this.phone,
    required this.credits,
    required this.role,
    required this.isPremium,
    required this.isActive,
    this.trialExpiresAt,
    this.premiumExpiresAt,
    required this.reputation,
    this.createdAt,
    this.referralCode,
  });

  bool get hasActivePremium => isPremium || role == 'premium';

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: asInt(json['id']),
      name: asString(json['name']),
      email: asString(json['email']),
      phone: asStringOrNull(json['phone']),
      credits: asInt(json['credits']),
      role: asString(json['role'], fallback: 'free'),
      isPremium: asBool(json['is_premium']),
      isActive: asBool(json['is_active'], fallback: true),
      trialExpiresAt: asDateTimeOrNull(json['trial_expires_at']),
      premiumExpiresAt: asDateTimeOrNull(json['premium_expires_at']),
      reputation: asInt(json['reputation']),
      createdAt: asDateTimeOrNull(json['created_at']),
      referralCode: asStringOrNull(json['referral_code']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'name': name,
      'email': email,
      'phone': phone,
      'credits': credits,
      'role': role,
      'is_premium': isPremium,
      'is_active': isActive,
      'trial_expires_at': trialExpiresAt?.toIso8601String(),
      'premium_expires_at': premiumExpiresAt?.toIso8601String(),
      'reputation': reputation,
      'created_at': createdAt?.toIso8601String(),
      'referral_code': referralCode,
    };
  }

  User copyWith({
    int? id,
    String? name,
    String? email,
    String? phone,
    int? credits,
    String? role,
    bool? isPremium,
    bool? isActive,
    DateTime? trialExpiresAt,
    DateTime? premiumExpiresAt,
    int? reputation,
    DateTime? createdAt,
    String? referralCode,
  }) {
    return User(
      id: id ?? this.id,
      name: name ?? this.name,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      credits: credits ?? this.credits,
      role: role ?? this.role,
      isPremium: isPremium ?? this.isPremium,
      isActive: isActive ?? this.isActive,
      trialExpiresAt: trialExpiresAt ?? this.trialExpiresAt,
      premiumExpiresAt: premiumExpiresAt ?? this.premiumExpiresAt,
      reputation: reputation ?? this.reputation,
      createdAt: createdAt ?? this.createdAt,
      referralCode: referralCode ?? this.referralCode,
    );
  }
}
