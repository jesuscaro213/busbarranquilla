# Spec 15 — Splash screen animado con bus

## Contexto

Actualmente la ruta `/loading` (mostrada mientras `AuthInitial` / `AuthLoading`) es un
`CircularProgressIndicator` centrado sobre fondo blanco. Se reemplaza por un splash screen
temático con animación de bus recorriendo la pantalla.

**Solo se modifica:**
- `lib/app.dart` — reemplazar el builder de `/loading` por `SplashScreen()`
- `lib/features/auth/screens/splash_screen.dart` (nuevo)

---

## Step 1 — Strings nuevos

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:

```dart
static const splashTagline = 'Barranquilla en tiempo real';
static const splashLoading = 'Cargando...';
```

---

## Step 2 — `SplashScreen` (nuevo archivo)

**Archivo:** `lib/features/auth/screens/splash_screen.dart`

```dart
import 'package:flutter/material.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _busPosition;
  late final Animation<double> _fadeIn;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(); // Loop indefinitely while loading

    // Bus travels from -0.15 (just off left edge) to 1.15 (just off right edge)
    _busPosition = Tween<double>(begin: -0.15, end: 1.15).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    // Text fades in once on first 400ms
    _fadeIn = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.2, curve: Curves.easeIn),
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      body: Stack(
        children: <Widget>[
          // Background subtle road line
          Positioned(
            left: 0,
            right: 0,
            top: MediaQuery.of(context).size.height * 0.58,
            child: Container(
              height: 3,
              color: Colors.white.withValues(alpha: 0.12),
            ),
          ),

          // Center content: logo + tagline
          Center(
            child: FadeTransition(
              opacity: _fadeIn,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  // App icon placeholder — bus emoji large
                  const Text(
                    '🚌',
                    style: TextStyle(fontSize: 64),
                  ),
                  const SizedBox(height: 16),
                  // App name
                  const Text(
                    AppStrings.appName,
                    style: TextStyle(
                      fontSize: 42,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(height: 8),
                  // Tagline
                  Text(
                    AppStrings.splashTagline,
                    style: TextStyle(
                      fontSize: 15,
                      color: Colors.white.withValues(alpha: 0.7),
                      letterSpacing: 0.3,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Animated bus traveling along the road line
          AnimatedBuilder(
            animation: _busPosition,
            builder: (context, child) {
              return Positioned(
                left: _busPosition.value * screenWidth,
                top: MediaQuery.of(context).size.height * 0.555,
                child: child!,
              );
            },
            child: const Text(
              '🚌',
              style: TextStyle(fontSize: 28),
            ),
          ),

          // Loading label at the bottom
          Positioned(
            left: 0,
            right: 0,
            bottom: 48,
            child: FadeTransition(
              opacity: _fadeIn,
              child: Text(
                AppStrings.splashLoading,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.45),
                  fontSize: 13,
                  letterSpacing: 1.2,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
```

---

## Step 3 — Conectar en `app.dart`

**Archivo:** `lib/app.dart`

### 3a — Agregar import

```dart
import 'features/auth/screens/splash_screen.dart';
```

### 3b — Reemplazar el builder de `/loading`

Reemplazar:

```dart
      GoRoute(
        path: '/loading',
        builder: (BuildContext context, GoRouterState state) => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      ),
```

por:

```dart
      GoRoute(
        path: '/loading',
        builder: (BuildContext context, GoRouterState state) => const SplashScreen(),
      ),
```

---

## Resultado visual esperado

1. Al abrir la app, mientras verifica el token JWT:
   - Fondo azul oscuro (`AppColors.primaryDark` = `#1E3A5F`)
   - Emoji 🚌 grande en el centro (64px)
   - Nombre **MiBus** en blanco (42px, bold)
   - Tagline "Barranquilla en tiempo real" debajo en blanco semitransparente
   - Una línea horizontal tenue a ~58% de la pantalla (la "carretera")
   - Un bus 🚌 pequeño (28px) que viaja de izquierda a derecha sobre esa línea en loop
   - Texto "Cargando..." muy sutil en la parte inferior
2. Al terminar de verificar → transición automática a `/map` o `/login` (manejo existente del router)

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `feat: animated splash screen with traveling bus`
