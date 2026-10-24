import { CredentialStore } from './credentials';
import { ConfigStore } from './config-store';
import { EchoFilter } from './echo-filter';
import { loadEnv, type BridgeEnv } from './env';
import { createEventPoster } from './event-post';
import { Outbox } from './outbox';
import { SendDedupe } from './send-dedupe';
import { SendQueue } from './send-queue';
import { createServer } from './server';
import { createRealZalo } from './zca-real';
import { createZaloClient, type ZaloClient } from './zalo-client';
import { join } from 'node:path';

let env: BridgeEnv;
try {
  env = loadEnv();
} catch (e) {
  console.error(`[bridge] cấu hình sai: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const now = () => Date.now();
const dir = env.ZALO_BRIDGE_DATA_DIR;

const outbox = new Outbox(
  dir,
  createEventPoster({
    url: env.API_EVENTS_URL,
    secret: env.ZALO_BRIDGE_SECRET,
    notify: (m) => client.send(m),
  }),
  now,
);

const client: ZaloClient = createZaloClient({
  zalo: createRealZalo(),
  credentials: new CredentialStore(dir, env.credentialsKey),
  configStore: new ConfigStore(dir),
  outbox,
  echo: new EchoFilter(now),
  queue: new SendQueue({ sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random }),
  dedupe: new SendDedupe(undefined, undefined, now, join(dir, 'sent.json')),
  now,
});

// Một lỗi rơi ngoài dự đoán (vd từ zca-js) không được làm cầu nối chết im lặng và mất phiên đang nghe.
process.on('unhandledRejection', (r) => console.error(`[bridge] unhandledRejection: ${r instanceof Error ? r.message : String(r)}`));

const server = createServer(client, env);
server.listen(env.PORT, env.HOST, () => console.log(`[bridge] nghe ${env.HOST}:${env.PORT}`));
outbox.start();
void client.start();

const shutdown = () => {
  outbox.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
