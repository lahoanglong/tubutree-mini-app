import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GomdonHealth, gomdonHealth } from '../../src/modules/integrations/gomdon/gomdon-health';
import { GOMDON_LOGIN_STATE_KEY, PrismaGomdonHealthStore } from '../../src/modules/integrations/gomdon/gomdon-health-store';
import { GOMDON_RECYCLING_TOGGLE_KEY, isGomdonRecyclingEnabled } from '../../src/modules/integrations/gomdon/gomdon-config';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { warmPool } from './helpers';

/**
 * R4-SYNC-4 (review) trên Postgres THẬT: lần Gomdon từ chối tài khoản nằm trong bản ghi chung (ops_health_states 'gomdon.login')
 * nên sống qua lần khởi động lại API. Ops làm đúng lời dặn ở thẻ Gomdon của admin — sửa env rồi khởi động lại — thì tiến trình
 * mới phải đăng nhập thử ngay lúc khởi động và bật lại lựa chọn thu gom cho MỌI replica, không đợi cron dò lại (30 phút kể từ lần
 * bị từ chối) hay admin bấm "Kiểm tra kết nối". Gomdon giả là server HTTP cục bộ, không gọi Gomdon thật.
 */
describe('Khởi động lại API sau khi sửa tài khoản Gomdon (real Postgres)', () => {
  const PORT = 4710;
  let prisma: PrismaService;
  let server: Server;
  let loginCalls = 0;
  let loginAccepted = true;
  const envKeys = ['GOMDON_BASE_URL', 'GOMDON_PHONE', 'GOMDON_PASSWORD'] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};
  const cfg = {
    get: async (k: string, fb?: unknown) => (k === GOMDON_RECYCLING_TOGGLE_KEY ? true : fb),
  } as unknown as SystemConfigService;

  const otherReplica = () => {
    const h = new GomdonHealth({ sharedMaxAgeMs: 0 });
    h.attachStore(new PrismaGomdonHealthStore(prisma));
    return h;
  };
  /** Tiến trình cũ (tài khoản sai) ghi lần bị từ chối cách đây `agoMs` — dưới ngưỡng 30 phút của cron dò lại. */
  const rejectedByPreviousProcess = async (agoMs: number) => {
    await otherReplica().recordError('Đăng nhập Gomdon thất bại (HTTP 401): sai mật khẩu', { credentialsRejected: true }, new Date(Date.now() - agoMs));
  };
  /** Tiến trình mới: trạng thái trong bộ nhớ trống, GomdonClient gắn bản ghi chung lúc dựng như trong Nest. */
  const freshProcess = () => {
    gomdonHealth.reset();
    return new GomdonClient(cfg, prisma);
  };

  beforeAll(async () => {
    for (const k of envKeys) savedEnv[k] = process.env[k];
    server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/api/v2/auth/login') {
        res.writeHead(404).end();
        return;
      }
      req.resume();
      req.on('end', () => {
        loginCalls++;
        res.setHeader('content-type', 'application/json');
        if (loginAccepted) {
          res.writeHead(200).end(
            JSON.stringify({ result: true, message: 'Đã đăng nhập thành công', data: { access_token: 'tok-race', token_type: 'Bearer', expires_at: null } }),
          );
        } else {
          res.writeHead(401).end(JSON.stringify({ result: false, message: 'Tài khoản hoặc mật khẩu không đúng', data: null }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
    process.env.GOMDON_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.GOMDON_PHONE = '0900000000';
    process.env.GOMDON_PASSWORD = 'mat-khau-gia';
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma.opsHealthState.deleteMany({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    await prisma?.$disconnect();
    await new Promise((resolve) => server.close(resolve));
    gomdonHealth.reset();
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(async () => {
    await prisma.opsHealthState.deleteMany({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    loginCalls = 0;
    loginAccepted = true;
  });

  it('tài khoản đã sửa: khởi động lại → đăng nhập thử một lần, mọi replica bật lại thu gom ngay', async () => {
    await rejectedByPreviousProcess(5 * 60_000);
    const client = freshProcess();
    expect(await isGomdonRecyclingEnabled(cfg, process.env, gomdonHealth)).toBe(false);
    expect(gomdonHealth.msSinceCredentialsRejected()).toBeLessThan(30 * 60_000);

    await client.recheckRejectedLoginOnBoot();

    expect(loginCalls).toBe(1);
    expect(await isGomdonRecyclingEnabled(cfg, process.env, gomdonHealth)).toBe(true);
    expect(await isGomdonRecyclingEnabled(cfg, process.env, otherReplica())).toBe(true);
    const row = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    expect(row.lastOkAt!.getTime()).toBeGreaterThan(row.lastErrorAt!.getTime());
  });

  it('tài khoản vẫn sai: khởi động lại → thử đúng một lần, ghi lại lần từ chối mới, thu gom vẫn ẩn ở mọi replica', async () => {
    await rejectedByPreviousProcess(5 * 60_000);
    const before = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    loginAccepted = false;
    const client = freshProcess();

    await expect(client.recheckRejectedLoginOnBoot()).resolves.toBeUndefined();

    expect(loginCalls).toBe(1);
    expect(await isGomdonRecyclingEnabled(cfg, process.env, gomdonHealth)).toBe(false);
    expect(await isGomdonRecyclingEnabled(cfg, process.env, otherReplica())).toBe(false);
    const row = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    expect(row.lastOkAt).toBeNull();
    expect(row.lastErrorAt!.getTime()).toBeGreaterThan(before.lastErrorAt!.getTime());
  });

  it('bản ghi chung không báo bị từ chối → khởi động không gọi Gomdon', async () => {
    await otherReplica().recordOk(new Date(Date.now() - 60_000));
    await freshProcess().recheckRejectedLoginOnBoot();
    expect(loginCalls).toBe(0);
  });
});
