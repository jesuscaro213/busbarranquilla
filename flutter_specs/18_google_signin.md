# Spec 18 — Google Sign-In en Login y Registro

## Contexto

El backend ya tiene `POST /api/auth/google` con rate limiting aplicado.
El frontend Flutter necesita el paquete `google_sign_in` y conectarlo al flujo de auth.

---

## Step 1 — Agregar dependencia

**Archivo:** `pubspec.yaml`

Agregar en la sección `dependencies`:

```yaml
  google_sign_in: ^6.2.1
```

Luego ejecutar:
```bash
flutter pub get
```

---

## Step 2 — Strings nuevos

**Archivo:** `lib/core/l10n/strings.dart`

```dart
static const loginWithGoogle = 'Continuar con Google';
static const googleSignInError = 'No se pudo iniciar sesión con Google';
static const googleSignInCancelled = 'Inicio de sesión cancelado';
```

---

## Step 3 — Método en `AuthRepository`

**Archivo:** `lib/core/data/repositories/auth_repository.dart`

Agregar el método `loginWithGoogle`:

```dart
Future<Result<void>> loginWithGoogle(String idToken) async {
  try {
    final response = await _dio.post<Map<String, dynamic>>(
      '/api/auth/google',
      data: <String, dynamic>{'idToken': idToken},
    );
    final token = response.data?['token'] as String?;
    if (token == null) return Failure(AppError('Token no recibido'));
    await _storage.writeToken(token);
    return const Success(null);
  } on DioException catch (e) {
    return Failure(AppError.fromDio(e));
  }
}
```

---

## Step 4 — Método en `AuthNotifier`

**Archivo:** `lib/features/auth/providers/auth_notifier.dart`

Agregar import:
```dart
import 'package:google_sign_in/google_sign_in.dart';
```

Agregar el método `loginWithGoogle()` a la clase `AuthNotifier`:

```dart
Future<void> loginWithGoogle() async {
  state = const AuthLoading();

  try {
    final googleSignIn = GoogleSignIn();
    final account = await googleSignIn.signIn();
    if (account == null) {
      // User cancelled
      state = const Unauthenticated();
      return;
    }

    final auth = await account.authentication;
    final idToken = auth.idToken;
    if (idToken == null) {
      state = AuthErrorState(AppStrings.googleSignInError);
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
    state = AuthErrorState(AppStrings.googleSignInError);
  }
}
```

---

## Step 5 — Botón Google en `LoginScreen`

**Archivo:** `lib/features/auth/screens/login_screen.dart`

### 5a — Import

```dart
import 'package:google_sign_in/google_sign_in.dart';
```

### 5b — Agregar el botón después del botón "Entrar" y antes del link de registro

Reemplazar:
```dart
              const SizedBox(height: 16),
              AppButton.primary(
                label: AppStrings.loginSubmit,
                isLoading: isLoading,
                onPressed: isLoading ? null : _submit,
              ),
              const SizedBox(height: 12),
              Row(
```

por:

```dart
              const SizedBox(height: 16),
              AppButton.primary(
                label: AppStrings.loginSubmit,
                isLoading: isLoading,
                onPressed: isLoading ? null : _submit,
              ),
              const SizedBox(height: 12),
              const _OrDivider(),
              const SizedBox(height: 12),
              _GoogleSignInButton(
                isLoading: isLoading,
                onPressed: isLoading
                    ? null
                    : () => ref.read(authNotifierProvider.notifier).loginWithGoogle(),
              ),
              const SizedBox(height: 12),
              Row(
```

### 5c — Widgets privados al final del archivo

Agregar al final de `login_screen.dart`:

```dart
class _OrDivider extends StatelessWidget {
  const _OrDivider();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        const Expanded(child: Divider()),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            'o',
            style: Theme.of(context).textTheme.bodySmall,
          ),
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
```

---

## Step 6 — Mismo botón en `RegisterScreen`

**Archivo:** `lib/features/auth/screens/register_screen.dart`

Agregar import de `auth_notifier.dart` (si no existe) y el mismo patrón:
después del botón "Crear cuenta" y antes del link "¿Ya tienes cuenta?", insertar:

```dart
              const SizedBox(height: 12),
              const _OrDivider(),
              const SizedBox(height: 12),
              _GoogleSignInButton(
                isLoading: isLoading,
                onPressed: isLoading
                    ? null
                    : () => ref.read(authNotifierProvider.notifier).loginWithGoogle(),
              ),
```

Y copiar los widgets `_OrDivider` y `_GoogleSignInButton` al final de `register_screen.dart`
(idénticos a los de `login_screen.dart`).

---

## Notas de configuración nativa (manual — NO hace Codex)

Estos pasos los debe hacer el desarrollador manualmente:

- **Android:** agregar `google-services.json` en `android/app/` y SHA-1 en Firebase Console
- **iOS:** agregar `GoogleService-Info.plist` en `ios/Runner/` y el URL scheme en `Info.plist`
- Sin estos archivos, el botón de Google aparece pero `googleSignIn.signIn()` lanzará excepción

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `feat: google sign-in button on login and register screens`
