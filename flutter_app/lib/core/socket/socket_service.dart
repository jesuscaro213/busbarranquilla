import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api_paths.dart';

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

  void emit(String event, dynamic data) {
    _socket?.emit(event, data);
  }

  void on(String event, void Function(dynamic) handler) {
    _socket?.on(event, handler);
  }

  void off(String event) {
    _socket?.off(event);
  }

  void joinRoute(int routeId) {
    emit('join:route', routeId);
  }

  void leaveRoute(int routeId) {
    emit('leave:route', routeId);
  }

  void sendLocation(double lat, double lng) {
    emit('bus:location', <String, double>{'lat': lat, 'lng': lng});
  }
}

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService.instance;
  ref.onDispose(service.dispose);
  return service;
});
