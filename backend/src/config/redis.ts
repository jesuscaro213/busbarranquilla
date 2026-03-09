import { createClient, type RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let redisConnectPromise: Promise<void> | null = null;

function buildRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!redisClient) {
    redisClient = createClient({ url: buildRedisUrl() });

    redisClient.on('error', (error) => {
      console.error('Error en Redis:', error);
    });
  }

  if (redisClient.isOpen) {
    return redisClient;
  }

  if (!redisConnectPromise) {
    redisConnectPromise = redisClient.connect().catch((error) => {
      console.error('No se pudo conectar a Redis:', error);
      redisConnectPromise = null;
      return Promise.reject(error);
    }).then(() => {
      redisConnectPromise = null;
    });
  }

  try {
    await redisConnectPromise;
    return redisClient;
  } catch {
    return null;
  }
}
