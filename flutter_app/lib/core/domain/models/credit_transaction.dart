import 'model_parsers.dart';

class CreditTransaction {
  final int id;
  final int userId;
  final int amount;
  final String type;
  final String? description;
  final DateTime? createdAt;

  const CreditTransaction({
    required this.id,
    required this.userId,
    required this.amount,
    required this.type,
    this.description,
    this.createdAt,
  });

  factory CreditTransaction.fromJson(Map<String, dynamic> json) {
    return CreditTransaction(
      id: asInt(json['id']),
      userId: asInt(json['user_id']),
      amount: asInt(json['amount']),
      type: asString(json['type']),
      description: asStringOrNull(json['description']),
      createdAt: asDateTimeOrNull(json['created_at']),
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'id': id,
      'user_id': userId,
      'amount': amount,
      'type': type,
      'description': description,
      'created_at': createdAt?.toIso8601String(),
    };
  }

  CreditTransaction copyWith({
    int? id,
    int? userId,
    int? amount,
    String? type,
    String? description,
    DateTime? createdAt,
  }) {
    return CreditTransaction(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      amount: amount ?? this.amount,
      type: type ?? this.type,
      description: description ?? this.description,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
