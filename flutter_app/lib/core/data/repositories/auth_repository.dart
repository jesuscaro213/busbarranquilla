import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_client.dart';
import '../../domain/models/user.dart';
import '../../error/app_error.dart';
import '../../error/result.dart';
import '../../storage/secure_storage.dart';
import '../sources/auth_remote_source.dart';
import 'repository_helpers.dart';

class AuthRepository {
  final AuthRemoteSource _source;
  final SecureStorage _storage;

  const AuthRepository(this._source, this._storage);

  Future<Result<User>> login(String email, String password) async {
    try {
      final data = await _source.login(email, password);
      final token = stringAt(data, 'token');
      final userJson = mapAt(data, 'user');
      final user = User.fromJson(userJson);

      if (token.isNotEmpty) {
        await _storage.writeToken(token);
      }

      return Success<User>(user);
    } on DioException catch (e) {
      return Failure<User>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<User>(UnknownError());
    }
  }

  Future<Result<User>> register({
    required String name,
    required String email,
    required String password,
    String? phone,
    String? referredByCode,
  }) async {
    try {
      final data = await _source.register(<String, dynamic>{
        'name': name,
        'email': email,
        'password': password,
        if (phone != null) 'phone': phone,
        if (referredByCode != null && referredByCode.isNotEmpty)
          'referred_by_code': referredByCode,
      });

      final token = stringAt(data, 'token');
      final userJson = mapAt(data, 'user');
      final user = User.fromJson(userJson);

      if (token.isNotEmpty) {
        await _storage.writeToken(token);
      }

      return Success<User>(user);
    } on DioException catch (e) {
      return Failure<User>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<User>(UnknownError());
    }
  }

  Future<Result<User>> getProfile() async {
    try {
      final data = await _source.getProfile();
      final user = User.fromJson(mapAt(data, 'user'));
      return Success<User>(user);
    } on DioException catch (e) {
      return Failure<User>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<User>(UnknownError());
    }
  }

  Future<Result<void>> logout() async {
    try {
      await _storage.deleteToken();
      return const Success<void>(null);
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }

  Future<Result<void>> loginWithGoogle(String idToken) async {
    try {
      final data = await _source.loginWithGoogle(idToken);
      final token = stringAt(data, 'token');
      if (token.isEmpty) {
        return const Failure<void>(AuthError('Token no recibido'));
      }
      await _storage.writeToken(token);
      return const Success<void>(null);
    } on DioException catch (e) {
      return Failure<void>(mappedErrorFromDio(e));
    } catch (_) {
      return const Failure<void>(UnknownError());
    }
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    AuthRemoteSource(ref.read(dioProvider)),
    ref.read(secureStorageProvider),
  );
});
