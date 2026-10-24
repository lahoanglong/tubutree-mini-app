import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAuthorized } from './auth';
import type { BridgeEnv } from './env';
import { BridgeError, type ZaloClient } from './zalo-client';

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'BAD_REQUEST');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'BAD_REQUEST');
  return parsed;
}

export function createServer(client: ZaloClient, env: Pick<BridgeEnv, 'ZALO_BRIDGE_SECRET'>): Server {
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const key = `${req.method} ${(req.url ?? '').split('?')[0]}`;
    switch (key) {
      case 'GET /health':
        return send(res, 200, client.state());
      case 'POST /qr/start':
        return send(res, 200, await client.qrStart());
      case 'GET /qr/status':
        return send(res, 200, client.qrStatus());
      case 'POST /logout':
        await client.logout();
        return send(res, 200, { ok: true });
      case 'POST /reconnect':
        // connect() có thể chạy tới 60 giây; kết quả đã có ở sự kiện trạng thái nên không giữ người gọi chờ.
        client.reconnect().catch(() => console.error('[bridge] kết nối lại lỗi'));
        return send(res, 200, { ok: true });
      case 'GET /groups':
        return send(res, 200, { groups: await client.groups() });
      case 'PUT /config': {
        const { groupId } = (await readJson(req)) as { groupId?: unknown };
        if (groupId !== null && typeof groupId !== 'string') return send(res, 400, { code: 'BAD_REQUEST' });
        await client.setGroup(groupId);
        return send(res, 200, { groupId });
      }
      case 'POST /send': {
        const { idempotencyKey, text } = (await readJson(req)) as { idempotencyKey?: unknown; text?: unknown };
        if (typeof idempotencyKey !== 'string' || !idempotencyKey || typeof text !== 'string' || !text) {
          return send(res, 400, { code: 'BAD_REQUEST' });
        }
        return send(res, 200, await client.send({ idempotencyKey, text }));
      }
      default:
        return send(res, 404, { code: 'NOT_FOUND' });
    }
  }

  return createHttpServer((req, res) => {
    // Kiểm Bearer trước cả đường dẫn: đường lạ cũng không được lộ gì cho người không có khoá.
    if (!isAuthorized(req.headers.authorization, env.ZALO_BRIDGE_SECRET)) {
      send(res, 401, { code: 'UNAUTHORIZED' });
      req.resume();
      return;
    }
    route(req, res).catch((e: unknown) => {
      if (res.headersSent) return;
      if (e instanceof HttpError) {
        if (e.status === 413) req.resume();
        return send(res, e.status, { code: e.code });
      }
      if (e instanceof BridgeError) {
        if (e.code === 'NOT_CONNECTED' || e.code === 'NO_GROUP' || e.code === 'QR_CANCELLED') return send(res, 409, { code: e.code });
        return send(res, 502, { code: e.code, message: e.message });
      }
      if (e instanceof SyntaxError) return send(res, 400, { code: 'BAD_REQUEST' });
      // Không đưa e.message ra ngoài: lỗi lạ có thể chứa dữ liệu nội bộ.
      console.error('[bridge] lỗi không lường trước');
      send(res, 500, { code: 'INTERNAL' });
    });
  });
}
