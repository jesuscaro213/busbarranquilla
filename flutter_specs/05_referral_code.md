# Spec 05 — Referral Code

## Web equivalent

- `Register.tsx` — optional "Código de referido" field; passed as `referred_by_code` in body
- `Profile.tsx` — shows user's own `referral_code` with copy-to-clipboard button

## Business rule

When user A registers using user B's referral code, user B receives +25 credits. New user also gets standard 50 credits welcome bonus.

## Backend fields

- `POST /api/auth/register` body: `{ ..., referred_by_code?: string }`
- `GET /api/auth/profile` response includes: `{ ..., referral_code: "ABC123" }`

---

## Step 1 — User model: add referralCode

**File:** `lib/core/domain/models/user.dart`

Add field:
```dart
final String? referralCode;
```

In constructor:
```dart
this.referralCode,
```

In `fromJson`:
```dart
referralCode: asStringOrNull(json['referral_code']),
```

In `toJson`:
```dart
'referral_code': referralCode,
```

In `copyWith`:
```dart
String? referralCode,
// ...
referralCode: referralCode ?? this.referralCode,
```

---

## Step 2 — AuthRepository: pass referral code on register

**File:** `lib/core/data/repositories/auth_repository.dart`

Find `register()` method. Update the body map to include `referred_by_code` if provided:

```dart
Future<Result<AuthResponse>> register({
  required String name,
  required String email,
  required String password,
  String? referredByCode,  // add this parameter
}) async {
  // In the body map:
  final body = <String, dynamic>{
    'name': name,
    'email': email,
    'password': password,
    if (referredByCode != null && referredByCode.isNotEmpty)
      'referred_by_code': referredByCode,
  };
  // rest of existing code...
}
```

---

## Step 3 — Strings

**File:** `lib/core/l10n/strings.dart`

Add:
```dart
static const referralCodeLabel = 'Código de referido (opcional)';
static const referralCodeHint = 'Ej: ABC123';
static const referralCodeSection = 'Tu código de referido';
static const referralCodeCopied = 'Código copiado al portapapeles';
static const referralCodeShare = 'Comparte tu código y gana +25 créditos por cada amigo';
static const referralCodeNone = 'Tu código se genera al registrarte';
```

---

## Step 4 — RegisterScreen: add referral code field

**File:** `lib/features/auth/screens/register_screen.dart`

Read the file first. Then:

1. Add a `TextEditingController` for the referral code:
```dart
final TextEditingController _referralController = TextEditingController();
```

2. Add it to `dispose()`:
```dart
_referralController.dispose();
```

3. Add the field in the form, after the password field and before the submit button:
```dart
const SizedBox(height: 12),
AppTextField(
  label: AppStrings.referralCodeLabel,
  hint: AppStrings.referralCodeHint,
  controller: _referralController,
),
```

4. Pass the value when calling register. Find where `authNotifierProvider.notifier.register(...)` or similar is called and add the referral code:
```dart
// Find the existing register call and add referredByCode:
ref.read(authNotifierProvider.notifier).register(
  name: _nameController.text.trim(),
  email: _emailController.text.trim(),
  password: _passwordController.text,
  referredByCode: _referralController.text.trim().isNotEmpty
      ? _referralController.text.trim()
      : null,
);
```

5. Update `AuthNotifier.register()` signature to accept `referredByCode`:

**File:** `lib/features/auth/providers/auth_notifier.dart`

```dart
Future<void> register({
  required String name,
  required String email,
  required String password,
  String? referredByCode,
}) async {
  // pass referredByCode to repository:
  final result = await ref.read(authRepositoryProvider).register(
    name: name,
    email: email,
    password: password,
    referredByCode: referredByCode,
  );
  // rest of existing code...
}
```

---

## Step 5 — ProfileScreen: show referral code

**File:** `lib/features/profile/screens/profile_screen.dart`

In `_ProfileReadyView.build()`, after the credits balance card and before the "Ver historial de créditos" button, add a referral code section:

```dart
import 'package:flutter/services.dart'; // for Clipboard

// Add this section:
const SizedBox(height: 16),
Container(
  padding: const EdgeInsets.all(14),
  decoration: BoxDecoration(
    color: AppColors.surface,
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: AppColors.divider),
  ),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(
        AppStrings.referralCodeSection,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
      ),
      const SizedBox(height: 6),
      if (user.referralCode != null) ...<Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                user.referralCode!,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 3,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.copy, size: 20),
              onPressed: () async {
                await Clipboard.setData(
                  ClipboardData(text: user.referralCode!),
                );
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(AppStrings.referralCodeCopied),
                      duration: Duration(seconds: 2),
                    ),
                  );
                }
              },
            ),
          ],
        ),
        const Text(
          AppStrings.referralCodeShare,
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
      ] else
        const Text(
          AppStrings.referralCodeNone,
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
    ],
  ),
),
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

Commit: `feat: referral code in register and profile`
