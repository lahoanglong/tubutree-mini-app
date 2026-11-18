import { gzipSync } from 'node:zlib';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { bodyParserErrorHandler, createBodyParsers, requestInputGuard } from '../../../common/body-limits';
import { readMssEnv } from '../mss/mss-config';
import { MSS_ENV_READER } from '../mss/mss-flags';
import { MSS_UNAUTHORIZED_BODY } from '../mss/mss-inbound.guard';
import { computeMssSignature } from '../mss/mss-signer';
import { CatalogSyncController } from './catalog-sync.controller';
import { CatalogSyncService } from './catalog-sync.service';

const INBOUND = 'inbound-secret-not-for-prod-0123456789abcdef';
const env = readMssEnv({
  NODE_ENV: 'test',
  MSS_BASE_URL: 'https://mss.example.test',
  MSS_KEY_ID: 'tubu-test',
  MSS_OUTBOUND_SECRET: 'outbound-secret-not-for-prod-0123456789',
  MSS_INBOUND_SECRET: INBOUND,
});

const BODY = {
  sync_id: 'sync-http-0001',
  stock: [{ pancake_variation_id: 'v1', stock: 0, as_of: '2026-11-18T16:00:00+07:00' }],
};

describe('POST /api/integrations/mss/catalog-sync (HTTP thật, chữ ký HMAC, tầng thân 1 MB)', () => {
  let app: INestApplication;
  let base: string;
  const receive = jest.fn(async (e: { syncId: string }) => ({ ok: true, sync_id: e.syncId }));

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const mod = await Test.createTestingModule({
      controllers: [CatalogSyncController],
      providers: [
        { provide: MSS_ENV_READER, useValue: () => env },
        { provide: CatalogSyncService, useValue: { receive } },
      ],
    }).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    app.use(...createBodyParsers('access-secret-not-for-prod-0123456789abc', 30), bodyParserErrorHandler, requestInputGuard);
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });
  beforeEach(() => receive.mockClear());

  const sign = (raw: Buffer | string, ts = Math.floor(Date.now() / 1000), secret = INBOUND) => ({
    'x-mss-key-id': 'tubu-test',
    'x-mss-timestamp': String(ts),
    'x-mss-signature': computeMssSignature(secret, ts, Buffer.from(raw)),
  });
  const post = (path: string, raw: string | Buffer, headers: Record<string, string>) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });

  it.each(['/api/integrations/mss/catalog-sync', '/api/internal/mss/catalog-sync'])('%s ký đúng: 200, chuyển phong bì đã đọc cho service', async (path) => {
    const raw = JSON.stringify(BODY);
    const res = await post(path, raw, sign(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sync_id: 'sync-http-0001' });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'sync-http-0001', stock: [expect.objectContaining({ pancakeVariationId: 'v1', stock: 0 })] }));
  });

  it('chữ ký sai, đổi thân sau khi ký, thiếu chữ ký: 401 thân chung, không gọi service (kể cả thân sai dạng)', async () => {
    const raw = JSON.stringify(BODY);
    const wrong = await post('/api/integrations/mss/catalog-sync', raw, sign(raw, undefined, 'wrong-secret-0123456789abcdef0123456789'));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(MSS_UNAUTHORIZED_BODY);
    expect((await post('/api/integrations/mss/catalog-sync', raw.replace('"stock":0', '"stock":9'), sign(raw))).status).toBe(401);
    expect((await post('/api/internal/mss/catalog-sync', '{"rác":1}', {})).status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
  });

  it('lệch giờ hơn 300 giây: 401', async () => {
    const raw = JSON.stringify(BODY);
    expect((await post('/api/integrations/mss/catalog-sync', raw, sign(raw, Math.floor(Date.now() / 1000) - 301))).status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
  });

  it('ký đúng mà thân sai dạng: 400 kèm mã lỗi', async () => {
    const raw = JSON.stringify({ sync_id: 'sync-http-0002' });
    const res = await post('/api/integrations/mss/catalog-sync', raw, sign(raw));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'empty' });
    expect(receive).not.toHaveBeenCalled();
  });

  it('lô 20 tài liệu ~30 KB (≈ 600 KB) ký trên byte gốc: 200; gửi gzip: chữ ký tính trên byte đã giải nén vẫn khớp', async () => {
    const products = Array.from({ length: 20 }, (_, i) => ({ pancake_product_id: `p${i}`, enrichment: { description_html: `<p>${'x'.repeat(30_000)}</p>` } }));
    const raw = JSON.stringify({ sync_id: 'sync-http-0003', products });
    expect(raw.length).toBeGreaterThan(600_000);
    expect((await post('/api/integrations/mss/catalog-sync', raw, sign(raw))).status).toBe(200);
    const gz = await post('/api/integrations/mss/catalog-sync', gzipSync(raw), { ...sign(raw), 'content-encoding': 'gzip' });
    expect(gz.status).toBe(200);
  });
});
