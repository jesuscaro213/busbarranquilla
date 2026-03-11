import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../../../core/data/repositories/auth_repository.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
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
    String? referredByCode,
  }) async {
    state = const AuthLoading();

    final result = await ref.read(authRepositoryProvider).register(
      name: name,
      email: email,
      password: password,
      phone: phone,
      referredByCode: referredByCode,
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

  Future<void> loginWithGoogle() async {
    state = const AuthLoading();

    try {
      final googleSignIn = GoogleSignIn();
      final account = await googleSignIn.signIn();
      if (account == null) {
        state = const Unauthenticated();
        return;
      }

      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        state = const AuthErrorState(AppStrings.googleSignInError);
        return;
      }

      final result = await ref.read(authRepositoryProvider).loginWithGoogle(idToken);
      switch (result) {
        case Success():
          await _refreshFromProfile();
        case Failure(error: final error):
          state = AuthErrorState(error.message);
      }
    } catch (_) {
      state = const AuthErrorState(AppStrings.googleSignInError);
    }
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
