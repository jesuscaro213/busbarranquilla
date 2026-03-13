import * as admin from 'firebase-admin';

let initialized = false;

function getApp(): admin.app.App | null {
  if (initialized) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    // Push notifications desactivadas — no es un error fatal
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson) as admin.ServiceAccount;
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('🔔 Firebase Admin inicializado');
    return admin.app();
  } catch (err) {
    console.error('❌ Error inicializando Firebase Admin:', err);
    return null;
  }
}

const REPORT_LABELS: Record<string, string> = {
  trancon: '🚧 Trancón reportado en tu ruta',
  lleno: '🔴 Bus lleno reportado en tu ruta',
  bus_disponible: '🟢 Bus con sillas disponibles en tu ruta',
  desvio: '⚠️ Desvío reportado en tu ruta',
  no_service: '🚫 Sin servicio reportado en tu ruta',
  sin_parar: '🚌 Bus sin parar reportado en tu ruta',
  espera: '⏱ Espera larga reportada en tu ruta',
};

async function sendToToken(
  app: admin.app.App,
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    await admin.messaging(app).send({
      token,
      notification: { title, body },
      data,
      android: {
        notification: {
          channelId: 'mibus_default',
          priority: 'high',
          sound: 'default',
        },
        priority: 'high',
      },
    });
  } catch (err: any) {
    // Token inválido/expirado — silenciar para no llenar el log
    if (err?.code !== 'messaging/registration-token-not-registered') {
      console.error('Push send error:', err?.message ?? err);
    }
  }
}

export async function sendPushToUser(
  fcmToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const app = getApp();
  if (!app || !fcmToken) return;
  await sendToToken(app, fcmToken, title, body, data);
}

export async function sendPushToUsers(
  fcmTokens: (string | null | undefined)[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const app = getApp();
  if (!app) return;
  const valid = fcmTokens.filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (valid.length === 0) return;
  await Promise.allSettled(valid.map(t => sendToToken(app, t, title, body, data)));
}

export { REPORT_LABELS };
