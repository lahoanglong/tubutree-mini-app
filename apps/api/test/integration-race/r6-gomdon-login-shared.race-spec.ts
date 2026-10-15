import { PrismaService } from '../../src/prisma/prisma.service';
import { GomdonHealth } from '../../src/modules/integrations/gomdon/gomdon-health';
import { GOMDON_LOGIN_STATE_KEY, PrismaGomdonHealthStore } from '../../src/modules/integrations/gomdon/gomdon-health-store';
import { GOMDON_RECYCLING_TOGGLE_KEY, isGomdonRecyclingEnabled } from '../../src/modules/integrations/gomdon/gomdon-config';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { warmPool } from './helpers';

/**
 * R4-SYNC-4 trên Postgres THẬT: hai replica (hai GomdonHealth, chung một DB) cùng một câu trả lời "Gomdon có đang từ chối tài
 * khoản không". Replica A bị từ chối lúc 14:03, replica B (leader) đăng nhập lại được lúc 14:05:38 → A cũng bật lại lựa chọn
 * thu gom, không cần job tình cờ chạy trên A hay admin bấm "Kiểm tra kết nối" đúng replica. Ghi song song nhiều mốc lẫn lộn thứ
 * tự: bản ghi chung luôn giữ hai mốc mới nhất.
 */
describe('Trạng thái đăng nhập Gomdon dùng chung giữa các replica (real Postgres)', () => {
  let prisma: PrismaService;
  const env = { GOMDON_BASE_URL: 'https://gomdon.invalid', GOMDON_PHONE: 'p', GOMDON_PASSWORD: 'x' } as NodeJS.ProcessEnv;
  const cfg = {
    get: async (k: string, fb?: unknown) => (k === GOMDON_RECYCLING_TOGGLE_KEY ? true : fb),
  } as unknown as Pick<SystemConfigService, 'get'>;

  const replica = () => {
    const h = new GomdonHealth({ sharedMaxAgeMs: 0 });
    h.attachStore(new PrismaGomdonHealthStore(prisma));
    return h;
  };
  const at = (hhmmss: string) => new Date(`2026-10-14T${hhmmss}.000Z`);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  afterAll(async () => {
    await prisma.opsHealthState.deleteMany({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.opsHealthState.deleteMany({ where: { key: GOMDON_LOGIN_STATE_KEY } });
  });

  it('A bị từ chối → B (chưa gọi Gomdon lần nào) ẩn thu gom; B đăng nhập lại được → A bật lại thu gom', async () => {
    const a = replica();
    const b = replica();
    await a.recordError('Đăng nhập Gomdon thất bại (HTTP 401): sai mật khẩu', { credentialsRejected: true }, at('14:03:00'));
    expect(await isGomdonRecyclingEnabled(cfg, env, b)).toBe(false);
    expect(await isGomdonRecyclingEnabled(cfg, env, a)).toBe(false);

    await b.recordOk(at('14:05:38'));
    expect(await isGomdonRecyclingEnabled(cfg, env, a)).toBe(true);
    expect(await isGomdonRecyclingEnabled(cfg, env, b)).toBe(true);
    const row = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: GOMDON_LOGIN_STATE_KEY } });
    expect(row).toMatchObject({ lastOkAt: at('14:05:38'), lastErrorAt: at('14:03:00') });
  });

  it('nhiều replica ghi song song, thứ tự lẫn lộn → giữ đúng mốc mới nhất của mỗi loại và lời lỗi của lần từ chối mới nhất', async () => {
    for (let round = 0; round < 5; round++) {
      await prisma.opsHealthState.deleteMany({ where: { key: GOMDON_LOGIN_STATE_KEY } });
      const base = Date.parse('2026-10-14T15:00:00.000Z') + round * 3_600_000;
      const writes = Array.from({ length: 40 }, (_, i) => ({ ok: Math.random() < 0.5, at: new Date(base + i * 1000), i }));
      const replicas = Array.from({ length: 4 }, replica);
      await Promise.all(
        writes
          .map((w) => ({ w, k: Math.random() }))
          .sort((x, y) => x.k - y.k)
          .map(({ w }) => {
            const r = replicas[w.i % replicas.length]!;
            return w.ok ? r.recordOk(w.at) : r.recordError(`từ chối #${w.i}`, { credentialsRejected: true }, w.at);
          }),
      );
      const lastOk = writes.filter((w) => w.ok).at(-1);
      const lastRejected = writes.filter((w) => !w.ok).at(-1);
      const row = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: GOMDON_LOGIN_STATE_KEY } });
      expect(row.lastOkAt).toEqual(lastOk?.at ?? null);
      expect(row.lastErrorAt).toEqual(lastRejected?.at ?? null);
      if (lastRejected) expect(row.lastError).toBe(`từ chối #${lastRejected.i}`);

      const fresh = replica();
      await fresh.refresh();
      expect(fresh.credentialsRejected).toBe(Boolean(lastRejected && (!lastOk || lastRejected.at > lastOk.at)));
    }
  });
});
