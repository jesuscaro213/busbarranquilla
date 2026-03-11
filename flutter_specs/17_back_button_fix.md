# Spec 17 — Fix back button en historial de viajes y créditos

## Problema

En `ProfileScreen`, los links a "Ver mis viajes" y "Ver historial de créditos" usan
`context.go()` que reemplaza la ruta — no deja back button en el AppBar de las pantallas
destino. El usuario queda atrapado.

## Fix

**Archivo:** `lib/features/profile/screens/profile_screen.dart`

Cambiar `context.go` → `context.push` en los dos TextButton del perfil:

```dart
// Ver historial de créditos
TextButton(
  onPressed: () => context.push('/profile/credits'),
  child: const Text(AppStrings.viewHistory),
),

// Ver mis viajes
TextButton(
  onPressed: () => context.push('/profile/trips'),
  child: const Text(AppStrings.tripHistoryLink),
),
```

Eso es todo. Flutter añade automáticamente el botón `←` en el AppBar de
`CreditsHistoryScreen` y `TripHistoryScreen` cuando son pushed.

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `fix: use context.push for trip/credits history so back button appears`
