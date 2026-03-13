import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../features/auth/providers/auth_notifier.dart';
import '../../../features/auth/providers/auth_state.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/app_text_field.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  String? _emailError;
  String? _passwordError;

  @override
  void initState() {
    super.initState();
    // If the screen mounts while auth is already in error state (e.g. after a
    // failed login redirected back here), show the error immediately.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final authState = ref.read(authNotifierProvider);
      if (authState is AuthErrorState) {
        AppSnackbar.show(context, authState.message, SnackbarType.error);
      }
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  bool _isValidEmail(String value) {
    final emailRegex = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    return emailRegex.hasMatch(value);
  }

  bool _validate() {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    String? emailError;
    String? passwordError;

    if (!_isValidEmail(email)) {
      emailError = AppStrings.validationEmailInvalid;
    }

    if (password.length < 6) {
      passwordError = AppStrings.validationPasswordMin;
    }

    setState(() {
      _emailError = emailError;
      _passwordError = passwordError;
    });

    return emailError == null && passwordError == null;
  }

  Future<void> _submit() async {
    if (!_validate()) return;

    TextInput.finishAutofillContext();
    await ref.read(authNotifierProvider.notifier).login(
          _emailController.text.trim(),
          _passwordController.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      switch (next) {
        case Authenticated():
          context.go('/map');
        case AuthErrorState(message: final message):
          AppSnackbar.show(context, message, SnackbarType.error);
        default:
          break;
      }
    });

    final authState = ref.watch(authNotifierProvider);
    final isLoading = authState is AuthLoading;

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      body: Column(
        children: <Widget>[
          // ── Header — mismo estilo que el splash ──────────────────────────
          Expanded(
            flex: 2,
            child: SafeArea(
              bottom: false,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Image.asset('assets/icon/logo.png', width: 300, height: 300),
                  ],
                ),
              ),
            ),
          ),

          // ── Formulario ───────────────────────────────────────────────────
          Expanded(
            flex: 3,
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              child: SafeArea(
                top: false,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                  child: AutofillGroup(
                    child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        AppStrings.loginTitle,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 20),
                      AppTextField(
                        label: AppStrings.emailLabel,
                        controller: _emailController,
                        errorText: _emailError,
                        autofillHints: const [AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        onChanged: (_) {
                          if (_emailError != null) {
                            setState(() => _emailError = null);
                          }
                        },
                      ),
                      const SizedBox(height: 12),
                      AppTextField(
                        label: AppStrings.passwordLabel,
                        controller: _passwordController,
                        obscureText: true,
                        errorText: _passwordError,
                        autofillHints: const [AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onEditingComplete: () {
                          TextInput.finishAutofillContext();
                          _submit();
                        },
                        onChanged: (_) {
                          if (_passwordError != null) {
                            setState(() => _passwordError = null);
                          }
                        },
                      ),
                      const SizedBox(height: 20),
                      AppButton.primary(
                        label: AppStrings.loginSubmit,
                        isLoading: isLoading,
                        onPressed: isLoading ? null : _submit,
                      ),
                      const SizedBox(height: 14),
                      const _OrDivider(),
                      const SizedBox(height: 14),
                      _GoogleSignInButton(
                        isLoading: isLoading,
                        onPressed: isLoading
                            ? null
                            : () => ref
                                .read(authNotifierProvider.notifier)
                                .loginWithGoogle(),
                      ),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          const Text(AppStrings.noAccount),
                          TextButton(
                            onPressed: () => context.go('/register'),
                            child: const Text(AppStrings.goToRegister),
                          ),
                        ],
                      ),
                    ],
                  ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        const Expanded(child: Divider()),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text('o', style: Theme.of(context).textTheme.bodySmall),
        ),
        const Expanded(child: Divider()),
      ],
    );
  }
}

class _GoogleSignInButton extends StatelessWidget {
  final bool isLoading;
  final VoidCallback? onPressed;

  const _GoogleSignInButton({required this.isLoading, this.onPressed});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Image.network(
            'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg',
            width: 20,
            height: 20,
            errorBuilder: (_, __, ___) => const Icon(Icons.g_mobiledata, size: 22),
          ),
          const SizedBox(width: 10),
          const Text(AppStrings.loginWithGoogle),
        ],
      ),
    );
  }
}
