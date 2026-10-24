export interface BridgeEnv {
  PORT: number;
  HOST: string;
  ZALO_BRIDGE_SECRET: string;
  ZALO_BRIDGE_DATA_DIR: string;
  API_EVENTS_URL: string;
  credentialsKey: Buffer;
}

export function loadEnv(raw: Record<string, string | undefined> = process.env): BridgeEnv {
  const secret = raw.ZALO_BRIDGE_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('ZALO_BRIDGE_SECRET phải dài ít nhất 32 ký tự');
  }
  const credentialsKey = Buffer.from(raw.ZALO_BRIDGE_CREDENTIALS_KEY ?? '', 'base64');
  if (credentialsKey.length !== 32) {
    throw new Error('ZALO_BRIDGE_CREDENTIALS_KEY phải giải base64 ra đúng 32 byte');
  }
  const port = raw.PORT ? Number(raw.PORT) : 3110;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT không hợp lệ');
  }
  return {
    PORT: port,
    HOST: raw.HOST || '0.0.0.0',
    ZALO_BRIDGE_SECRET: secret,
    ZALO_BRIDGE_DATA_DIR: raw.ZALO_BRIDGE_DATA_DIR || '/data',
    API_EVENTS_URL: raw.API_EVENTS_URL || 'http://api:3001/api/internal/zalo-bridge/events',
    credentialsKey,
  };
}
