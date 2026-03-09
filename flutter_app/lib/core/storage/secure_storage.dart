import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class SecureStorage {
  Future<String?> readToken();
  Future<void> writeToken(String token);
  Future<void> deleteToken();
}

class SecureStorageImpl implements SecureStorage {
  static const _tokenKey = 'auth_token';

  final FlutterSecureStorage _storage;

  const SecureStorageImpl(this._storage);

  @override
  Future<String?> readToken() => _storage.read(key: _tokenKey);

  @override
  Future<void> writeToken(String token) => _storage.write(key: _tokenKey, value: token);

  @override
  Future<void> deleteToken() => _storage.delete(key: _tokenKey);
}

final secureStorageProvider = Provider<SecureStorage>((ref) {
  return const SecureStorageImpl(FlutterSecureStorage());
});
