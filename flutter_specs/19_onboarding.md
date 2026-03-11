# Spec 19 — Onboarding para primeros usuarios

## Contexto

La primera vez que el usuario abre la app, antes de llegar a login, debe ver 3 slides
explicando qué es MiBus. Se muestra **una sola vez** — se guarda en `SharedPreferences`
la clave `'onboarding_done'`. Si ya la vio, va directo a `/loading` (auth check) como siempre.

`shared_preferences` ya está en `pubspec.yaml`.

---

## Step 1 — Strings nuevos

**Archivo:** `lib/core/l10n/strings.dart`

```dart
// Onboarding
static const onboardingSkip = 'Omitir';
static const onboardingNext = 'Siguiente';
static const onboardingStart = 'Empezar';

static const onboarding1Title = '¿Dónde está el bus?';
static const onboarding1Body =
    'MiBus te muestra en tiempo real dónde están los buses de Barranquilla, '
    'reportados por los mismos pasajeros.';

static const onboarding2Title = 'Tú eres el GPS';
static const onboarding2Body =
    'Cuando te subes al bus, transmites tu ubicación en vivo. '
    'Otros pasajeros te ven moverse en el mapa y saben que el bus viene.';

static const onboarding3Title = 'Gana créditos';
static const onboarding3Body =
    'Reportar trancones, confirmar reportes y completar viajes te da créditos. '
    'Úsalos para activar alertas de bajada y más.';
```

---

## Step 2 — Provider para saber si el onboarding ya se vio

**Archivo:** `lib/core/storage/onboarding_storage.dart` (nuevo)

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _kOnboardingDone = 'onboarding_done';

class OnboardingStorage {
  Future<bool> isDone() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kOnboardingDone) ?? false;
  }

  Future<void> markDone() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kOnboardingDone, true);
  }
}

final onboardingStorageProvider = Provider<OnboardingStorage>(
  (_) => OnboardingStorage(),
);
```

---

## Step 3 — `OnboardingScreen` (nuevo archivo)

**Archivo:** `lib/features/auth/screens/onboarding_screen.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/storage/onboarding_storage.dart';
import '../../../core/theme/app_colors.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  static const _pages = <_OnboardingPage>[
    _OnboardingPage(
      emoji: '🗺️',
      title: AppStrings.onboarding1Title,
      body: AppStrings.onboarding1Body,
    ),
    _OnboardingPage(
      emoji: '🚌',
      title: AppStrings.onboarding2Title,
      body: AppStrings.onboarding2Body,
    ),
    _OnboardingPage(
      emoji: '⭐',
      title: AppStrings.onboarding3Title,
      body: AppStrings.onboarding3Body,
    ),
  ];

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(onboardingStorageProvider).markDone();
    if (mounted) context.go('/loading');
  }

  void _next() {
    if (_currentPage < _pages.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _finish();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLast = _currentPage == _pages.length - 1;

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            // Skip button
            Align(
              alignment: Alignment.topRight,
              child: TextButton(
                onPressed: _finish,
                child: Text(
                  AppStrings.onboardingSkip,
                  style: const TextStyle(color: Colors.white70),
                ),
              ),
            ),

            // Page content
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _pages.length,
                onPageChanged: (index) => setState(() => _currentPage = index),
                itemBuilder: (context, index) {
                  final page = _pages[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Text(
                          page.emoji,
                          style: const TextStyle(fontSize: 80),
                        ),
                        const SizedBox(height: 32),
                        Text(
                          page.title,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          page.body,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.white.withValues(alpha: 0.75),
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),

            // Dots indicator
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List<Widget>.generate(_pages.length, (index) {
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: _currentPage == index ? 20 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _currentPage == index
                        ? Colors.white
                        : Colors.white.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
            const SizedBox(height: 32),

            // Next / Start button
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: FilledButton(
                onPressed: _next,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: AppColors.primaryDark,
                  minimumSize: const Size.fromHeight(52),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Text(
                  isLast ? AppStrings.onboardingStart : AppStrings.onboardingNext,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

class _OnboardingPage {
  final String emoji;
  final String title;
  final String body;

  const _OnboardingPage({
    required this.emoji,
    required this.title,
    required this.body,
  });
}
```

---

## Step 4 — Ruta `/onboarding` en `app.dart`

**Archivo:** `lib/app.dart`

### 4a — Import

```dart
import 'features/auth/screens/onboarding_screen.dart';
import 'core/storage/onboarding_storage.dart';
```

### 4b — Agregar la ruta

Dentro de las rutas (fuera del ShellRoute, junto a `/loading`, `/login`):

```dart
      GoRoute(
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) => const OnboardingScreen(),
      ),
```

### 4c — Modificar el redirect para chequear onboarding

El redirect actual en `GoRouter` es síncrono y no puede hacer `await`. La solución es
leer el valor de `SharedPreferences` a través de un `FutureProvider` y usarlo en el redirect.

**Agregar el provider** en `app.dart` (antes del `appRouterProvider`):

```dart
final onboardingDoneProvider = FutureProvider<bool>((ref) async {
  return ref.read(onboardingStorageProvider).isDone();
});
```

**Modificar `appRouterProvider`** para observar `onboardingDoneProvider`:

```dart
final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);
  final onboardingAsync = ref.watch(onboardingDoneProvider);

  return GoRouter(
    initialLocation: '/map',
    redirect: (context, state) {
      final isGoingToAuth =
          state.matchedLocation == '/login' || state.matchedLocation == '/register';
      final isLoading = state.matchedLocation == '/loading';
      final isOnboarding = state.matchedLocation == '/onboarding';

      // If onboarding check not ready yet, stay on loading
      final onboardingDone = onboardingAsync.valueOrNull ?? true;

      // Show onboarding first time only (when not yet done)
      if (!onboardingDone && !isOnboarding) return '/onboarding';

      return switch (authState) {
        AuthInitial() || AuthLoading() => isLoading ? null : '/loading',
        Authenticated() => isLoading || isGoingToAuth || isOnboarding ? '/map' : null,
        Unauthenticated() || AuthErrorState() => isGoingToAuth ? null : '/login',
      };
    },
    routes: <RouteBase>[
      // ... existing routes unchanged, just add /onboarding
    ],
  );
});
```

**Nota:** solo agregar `onboardingAsync` y la línea del check `!onboardingDone`. El resto
del redirect y todas las rutas permanecen exactamente igual.

---

## Resultado visual esperado

1. Primera apertura de la app → pantalla azul oscuro con onboarding
2. Slide 1: emoji 🗺️ + "¿Dónde está el bus?" + descripción
3. Slide 2: emoji 🚌 + "Tú eres el GPS"
4. Slide 3: emoji ⭐ + "Gana créditos" + botón "Empezar"
5. Botón "Omitir" en la esquina superior derecha en cualquier slide
6. Dots de progreso animados en la parte inferior
7. Al tocar "Empezar" u "Omitir" → marca `onboarding_done = true` → va a `/loading` → flujo normal
8. Segunda apertura: salta el onboarding directamente

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `feat: onboarding screen shown once on first app launch`
