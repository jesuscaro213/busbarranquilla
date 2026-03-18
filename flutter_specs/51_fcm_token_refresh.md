# Spec 51 — FCM token refresh automático

## Problem

`AuthNotifier._registerFcmToken()` guarda el token al hacer login/startup. Pero Android rota
el FCM token periódicamente (tras borrar datos, reinstalar, o por política de Google). Cuando
el token rota, el backend queda con el token viejo → los pushes llegan a un token inválido
→ `messaging/registration-token-not-registered` silenciado en `pushNotificationService.ts`
→ usuario no recibe nada hasta su próximo login.

> **Nota:** el sistema de pushes en sí (backend FCM, background handler Flutter, routing de tap)
> ya está completamente implementado. Este spec solo cierra el hueco del token rotado.

---

## File 1 — `lib/app.dart`

In `_MiBusAppState.initState()`, after the existing `NotificationService` wiring, add the
`onTokenRefresh` listener:

**Old:**
```dart
    NotificationService.onNotificationTap = _handleLocalNotificationTap;
    NotificationService.getLaunchPayload().then((payload) {
      if (payload != null) _handleLocalNotificationTap(payload);
    });
  }
```

**New:**
```dart
    NotificationService.onNotificationTap = _handleLocalNotificationTap;
    NotificationService.getLaunchPayload().then((payload) {
      if (payload != null) _handleLocalNotificationTap(payload);
    });

    // Keep backend FCM token in sync when Android rotates it.
    NotificationService.listenTokenRefresh((newToken) {
      ref.read(authRepositoryProvider).updateFcmToken(newToken);
    });
  }
```

Add import at the top of the file:
```dart
import 'core/data/repositories/auth_repository.dart';
```

---

## File 2 — `lib/core/notifications/notification_service.dart`

Add the `listenTokenRefresh` static method after `setOnMessageOpenedApp`:

**Old:**
```dart
  /// Registers a callback invoked when the user taps a notification while
  /// the app is in the background (but not terminated).
  static void setOnMessageOpenedApp(
    void Function(Map<String, dynamic> data) onTap,
  ) {
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      onTap(message.data);
    });
  }
}
```

**New:**
```dart
  /// Registers a callback invoked when the user taps a notification while
  /// the app is in the background (but not terminated).
  static void setOnMessageOpenedApp(
    void Function(Map<String, dynamic> data) onTap,
  ) {
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      onTap(message.data);
    });
  }

  /// Registers a callback invoked when the FCM registration token is rotated
  /// by Android/iOS. Call this once on app startup.
  static void listenTokenRefresh(void Function(String token) onRefresh) {
    FirebaseMessaging.instance.onTokenRefresh.listen(onRefresh);
  }
}
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior after this spec

- App starts → login → `_registerFcmToken()` saves token immediately ✅ (already working)
- Android rotates token → `onTokenRefresh` fires → backend gets new token → pushes keep working ✅
- Pushes con app cerrada: backend envía `notification + data` → Android muestra notificación nativa → usuario toca → app abre → `getInitialMessage()` / `onMessageOpenedApp` routea al destino correcto ✅

## Para verificar en producción

Si las pushes aún no llegan tras la reinstalación, verificar que la variable de entorno
`FIREBASE_SERVICE_ACCOUNT` está configurada en Railway con el JSON de la service account de
Firebase Admin SDK. Sin esta variable, `pushNotificationService.ts` retorna `null` silenciosamente
y no envía nada.
