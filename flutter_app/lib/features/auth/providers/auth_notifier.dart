import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/auth_repository.dart';
import '../../../core/error/result.dart';
import 'auth_state.dart';

class AuthNotifier extends Notifier<AuthState> {
  bool _didInitialize = false;

  @override
  AuthState build() {
    if (!_didInitialize) {
      _didInitialize = true;
      Future<void>(() => initialize());
    }
    return const AuthInitial();
  }

  Future<void> initialize() async {
    state = const AuthLoading();
    await _refreshFromProfile();
  }

  Future<void> login(String email, String password) async {
    state = const AuthLoading();

    final result = await ref.read(authRepositoryProvider).login(email, password);
    switch (result) {
      case Success():
        await _refreshFromProfile();
      case Failure(error: final error):
        state = AuthErrorState(error.message);
    }
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
    String? phone,
  }) async {
    state = const AuthLoading();

    final result = await ref.read(authRepositoryProvider).register(
      name: name,
      email: email,
      password: password,
      phone: phone,
    );

    switch (result) {
      case Success():
        await _refreshFromProfile();
      case Failure(error: final error):
        state = AuthErrorState(error.message);
    }
  }

  Future<void> logout() async {
    state = const AuthLoading();
    await ref.read(authRepositoryProvider).logout();
    state = const Unauthenticated();
  }

  Future<void> _refreshFromProfile() async {
    final profile = await ref.read(authRepositoryProvider).getProfile();
    state = switch (profile) {
      Success(data: final user) => Authenticated(user),
      Failure() => const Unauthenticated(),
    };
  }
}

final authNotifierProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);
