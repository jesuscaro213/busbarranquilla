# Spec 16 — Fixes de navegación: boarding sin nav bar + planner que persiste

## Problema 1 — BoardingScreen sin navegación

`/trip/boarding` está fuera del `ShellRoute`, por lo que:
- No tiene `BottomNavigationBar` — el usuario no puede ir a planner, perfil ni mapa
- El FAB en `MapScreen` llama `context.go('/trip/boarding')` (reemplaza la ruta, no hace push), por lo que tampoco hay botón de volver automático en el AppBar

**Fix:** mover la ruta `/trip/boarding` DENTRO del `ShellRoute`. Así hereda el
`BottomNavigationBar` del `MainShell`. El `_indexFromLocation` del shell ya mapea
`/trip/boarding` → índice 2 (tab "Viaje"), que es correcto.

## Problema 2 — Planner markers persisten al ir al mapa

`PlanMarkersLayer` en `MapScreen` observa `plannerNotifierProvider`. Cuando el usuario
planea un viaje (selecciona origen + destino) y luego toca el tab de Mapa, los marcadores
de origen y destino siguen apareciendo en el mapa.

**Fix:** añadir método `reset()` a `PlannerNotifier` que limpia el estado. Llamarlo desde
`MainShell.onTap` al navegar al tab 0 (Mapa).

---

## Archivos a modificar

- `lib/app.dart` — mover `/trip/boarding` dentro del `ShellRoute`
- `lib/features/planner/providers/planner_notifier.dart` — añadir `reset()`
- `lib/features/shell/main_shell.dart` — llamar `reset()` al ir al tab de mapa

---

## Step 1 — Mover `/trip/boarding` al `ShellRoute` en `app.dart`

**Archivo:** `lib/app.dart`

### 1a — Eliminar la ruta fuera del ShellRoute

Eliminar este bloque que está FUERA del `ShellRoute`:

```dart
      GoRoute(
        path: '/trip/boarding',
        builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
      ),
```

### 1b — Añadirla DENTRO del ShellRoute

Dentro del `ShellRoute`, junto a `/map`, `/planner`, `/trip`, `/profile`, agregar:

```dart
          GoRoute(
            path: '/trip/boarding',
            builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
          ),
```

El bloque completo del `ShellRoute` queda así:

```dart
      ShellRoute(
        builder: (BuildContext context, GoRouterState state, Widget child) {
          return MainShell(child: child);
        },
        routes: <RouteBase>[
          GoRoute(
            path: '/map',
            builder: (BuildContext context, GoRouterState state) => const MapScreen(),
          ),
          GoRoute(
            path: '/planner',
            builder: (BuildContext context, GoRouterState state) => const PlannerScreen(),
          ),
          GoRoute(
            path: '/trip',
            builder: (BuildContext context, GoRouterState state) => const ActiveTripScreen(),
          ),
          GoRoute(
            path: '/trip/boarding',
            builder: (BuildContext context, GoRouterState state) => const BoardingScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (BuildContext context, GoRouterState state) => const ProfileScreen(),
          ),
        ],
      ),
```

---

## Step 2 — Añadir `reset()` a `PlannerNotifier`

**Archivo:** `lib/features/planner/providers/planner_notifier.dart`

Añadir el método `reset()` a la clase `PlannerNotifier`, después de `setDestination()`:

```dart
  void reset() {
    _selectedOrigin = null;
    _selectedDest = null;
    state = const PlannerIdle();
  }
```

---

## Step 3 — Llamar `reset()` al cambiar al tab de mapa

**Archivo:** `lib/features/shell/main_shell.dart`

### 3a — Import del provider

El import de `planner_notifier.dart` debe añadirse:

```dart
import '../planner/providers/planner_notifier.dart';
```

### 3b — Modificar `onTap` del `BottomNavigationBar`

Reemplazar:

```dart
        onTap: (index) => context.go(_tabs[index]),
```

por:

```dart
        onTap: (index) {
          // Clear planner state when navigating to the map tab
          if (index == 0) {
            ref.read(plannerNotifierProvider.notifier).reset();
          }
          context.go(_tabs[index]);
        },
```

---

## Resultado esperado

### Fix 1
1. El usuario toca el FAB "Me subí" en el mapa → va a `BoardingScreen`
2. El `BottomNavigationBar` es visible — puede tocar Rutas, Viaje o Perfil para navegar
3. El tab activo muestra el ícono de "Viaje" (índice 2) mientras está en boarding
4. Si el usuario quiere volver al mapa, toca el tab Mapa

### Fix 2
1. El usuario va a "Mis Rutas" (planner), escribe un destino, busca rutas
2. Toca el tab "Mapa"
3. Los marcadores de origen y destino desaparecen del mapa — estado limpio
4. Si vuelve al planner, los campos están vacíos y puede planear de nuevo

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `fix: boarding screen gets nav bar + planner state resets on map tab`
