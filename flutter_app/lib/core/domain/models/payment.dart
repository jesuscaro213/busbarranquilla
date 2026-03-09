import 'model_parsers.dart';

class Payment {
  final int id;
  final int? userId;
  final String wompiReference;
  final String? wompiTransactionId;
  final String plan;
  final int amountCents;
  final String currency;
  final String status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const Payment({
    required this.id,
    this.userId,
    required this.wompiReference,
    this.wompiTransactionId,
    required this.plan,
    required this.amountCents,
    required this.currency,
    required this.status,
    this.createdAt,
    this.updatedAt,
  });

  factory Payment.fromJson(Map<String, dynamic> json) {
    return Payment(
      id: asInt(json['id']),
      userId: asIntOrNull(json['user_id']),
      wompiReference: asString(json['wompi_reference']),
      wompiTransactionId: asStringOrNull(json['wompi_transaction_id']),
      plan: asString(json['plan']),
      amountCents: asInt(json['amount_cents']),
      currency: asString(json['currency'], fallback: 'COP'),
      status: asString(json['status']),
      createdAt: asDateTimeOrNull(json['created_at']),
      updatedAt: asDateTimeOrNull(json['updated_at']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'user_id': userId,
      'wompi_reference': wompiReference,
      'wompi_transaction_id': wompiTransactionId,
      'plan': plan,
      'amount_cents': amountCents,
      'currency': currency,
      'status': status,
      'created_at': createdAt?.toIso8601String(),
      'updated_at': updatedAt?.toIso8601String(),
    };
  }

  Payment copyWith({
    int? id,
    int? userId,
    String? wompiReference,
    String? wompiTransactionId,
    String? plan,
    int? amountCents,
    String? currency,
    String? status,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Payment(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      wompiReference: wompiReference ?? this.wompiReference,
      wompiTransactionId: wompiTransactionId ?? this.wompiTransactionId,
      plan: plan ?? this.plan,
      amountCents: amountCents ?? this.amountCents,
      currency: currency ?? this.currency,
      status: status ?? this.status,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
