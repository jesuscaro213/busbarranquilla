# Spec 48 — Socket.io reconnection automática durante viaje

## Problem

`SocketService` tiene `enableReconnection()` activo, así que socket_io_client reconecta
el WebSocket automáticamente cuando se recupera la señal. Sin embargo, al reconectar
el cliente NO re-emite `join:route` — el servidor no sabe que el usuario sigue en la
sala de esa ruta. Consecuencia: reportes y confirmaciones en tiempo real dejan de llegar
al pasajero sin ningún aviso visible, hasta que cierra y reabre la app.

---

## File 1 — `lib/core/socket/socket_service.dart`

### Change A: Add `onReconnect` callback + hook into socket reconnect event

**Old:**
```dart
class SocketService {
  SocketService._();

  static final SocketService _instance = SocketService._();
  static SocketService get instance => _instance;

  io.Socket? _socket;
  bool _connected = false;

  bool get isConnected => _connected;

  void connect(String token) {
    if (_connected) return;

    _socket = io.io(
      ApiPaths.baseUrl,
      io.OptionBuilder()
          .setTransports(<String>['websocket'])
          .setExtraHeaders(<String, String>{'Authorization': 'Bearer $token'})
          .enableAutoConnect()
          .enableReconnection()
          .build(),
    );

    _socket?.onConnect((_) => _connected = true);
    _socket?.onDisconnect((_) => _connected = false);
  }
```

**New:**
```dart
class SocketService {
  SocketService._();

  static final SocketService _instance = SocketService._();
  static SocketService get instance => _instance;

  io.Socket? _socket;
  bool _connected = false;

  /// Called every time the socket successfully reconnects after a drop.
  /// Set by TripNotifier to re-join the active route room.
  void Function()? onReconnect;

  bool get isConnected => _connected;

  void connect(String token) {
    if (_connected) return;

    _socket = io.io(
      ApiPaths.baseUrl,
      io.OptionBuilder()
          .setTransports(<String>['websocket'])
          .setExtraHeaders(<String, String>{'Authorization': 'Bearer $token'})
          .enableAutoConnect()
          .enableReconnection()
          .build(),
    );

    _socket?.onConnect((_) => _connected = true);
    _socket?.onDisconnect((_) => _connected = false);
    _socket?.on('reconnect', (_) {
      _connected = true;
      onReconnect?.call();
    });
  }
```

### Change B: Clear `onReconnect` in `disconnect()` and `dispose()`

**Old:**
```dart
  void disconnect() {
    _socket?.disconnect();
    _connected = false;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _connected = false;
  }
```

**New:**
```dart
  void disconnect() {
    _socket?.disconnect();
    _connected = false;
    onReconnect = null;
  }

  void dispose() {
    _socket?.dispose();
    _socket = null;
    _connected = false;
    onReconnect = null;
  }
```

---

## File 2 — `lib/features/trip/providers/trip_notifier.dart`

### Change A: Register reconnect handler when trip starts

In `startTrip()`, after `_startLocationBroadcast()`, add:

```dart
    // Re-join the route room after any socket reconnection so real-time
    // reports and confirmations keep flowing without restarting the app.
    ref.read(socketServiceProvider).onReconnect = () {
      ref.read(socketServiceProvider).joinRoute(routeId);
    };
```

### Change B: Clear handler when trip ends

In `_disposeMonitorsAndTimers()`, add alongside the other cleanup:

```dart
    ref.read(socketServiceProvider).onReconnect = null;
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior after this spec

- **Signal lost mid-trip:** socket disconnects, `_connected = false`
- **Signal recovered:** socket_io_client reconnects automatically (already configured),
  fires `'reconnect'` event → `SocketService` calls `onReconnect` →
  `TripNotifier` emits `join:route` with the active route ID
- **Server:** sees the client rejoin the room and resumes sending `route:new_report`,
  `route:report_confirmed`, `route:report_resolved` events
- **User:** never notices the drop — reports continue appearing in real time
- **After trip ends:** `onReconnect = null` — no stale handler
