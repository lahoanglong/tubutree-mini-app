import { GomdonHealth, type GomdonHealthStore, type GomdonLoginRecord } from './gomdon-health';
import { GOMDON_RECYCLING_TOGGLE_KEY, isGomdonRecyclingEnabled } from './gomdon-config';
import type { SystemConfigService } from '../../system-config/system-config.service';

/** Bản ghi chung giả lập ops_health_states: mỗi cột chỉ tiến (GREATEST), như câu SQL của PrismaGomdonHealthStore. */
function sharedStore() {
  const rec: GomdonLoginRecord = { okAt: null, rejectedAt: null, rejectedMessage: null };
  const later = (a: Date | null, b: Date) => (!a || b > a ? b : a);
  const store: GomdonHealthStore & { loads: number } = {
    loads: 0,
    load: async () => {
      store.loads += 1;
      return { ...rec };
    },
    recordOk: async (at) => {
      rec.okAt = later(rec.okAt, at);
    },
    recordRejected: async (at, message) => {
      if (!rec.rejectedAt || at >= rec.rejectedAt) rec.rejectedMessage = message;
      rec.rejectedAt = later(rec.rejectedAt, at);
    },
  };
  return { store, rec };
}

const at = (hhmmss: string) => new Date(`2026-10-14T${hhmmss}.000Z`);

/** Replica đọc lại bản ghi chung mỗi lần hỏi (chu kỳ 0) — để ca kiểm không phụ thuộc đồng hồ. */
function replica(store: GomdonHealthStore): GomdonHealth {
  const h = new GomdonHealth({ sharedMaxAgeMs: 0 });
  h.attachStore(store);
  return h;
}

/**
 * R4-SYNC-4: trạng thái "Gomdon từ chối đăng nhập" phải chung cho mọi replica. Trước đây nằm trong bộ nhớ từng process: replica
 * không phải leader không bao giờ tự dò lại nên cứ ẩn lựa chọn thu gom sau khi Gomdon đã ổn; nút "Kiểm tra kết nối" chỉ chữa
 * đúng replica nhận request.
 */
describe('GomdonHealth dùng chung giữa các replica (R4-SYNC-4)', () => {
  it('replica A bị từ chối → replica B đọc thấy; B đăng nhập lại được → A thôi coi là bị từ chối', async () => {
    const { store } = sharedStore();
    const a = replica(store);
    const b = replica(store);

    await a.recordError('Đăng nhập Gomdon thất bại (HTTP 401): sai mật khẩu', { credentialsRejected: true }, at('14:03:00'));
    await b.refresh();
    expect(b.credentialsRejected).toBe(true);
    expect(b.snapshot()).toMatchObject({ credentialsRejectedAt: at('14:03:00').toISOString(), lastError: expect.stringContaining('sai mật khẩu') });

    await b.recordOk(at('14:05:38'));
    await a.refresh();
    expect(a.credentialsRejected).toBe(false);
    expect(a.snapshot().lastOkAt).toBe(at('14:05:38').toISOString());
  });

  it('lần đăng nhập tốt CŨ ghi muộn không xoá lần từ chối MỚI hơn', async () => {
    const { store } = sharedStore();
    const a = replica(store);
    const b = replica(store);
    await a.recordError('sai mật khẩu', { credentialsRejected: true }, at('14:10:00'));
    await b.recordOk(at('14:09:59'));
    const c = replica(store);
    await c.refresh();
    expect(c.credentialsRejected).toBe(true);
  });

  it('mỗi replica đọc bản ghi chung tối đa một lần mỗi chu kỳ (không thêm một truy vấn cho mỗi lượt mở trang)', async () => {
    const { store } = sharedStore();
    const h = new GomdonHealth();
    h.attachStore(store);
    await Promise.all([h.refresh(), h.refresh(), h.refresh()]);
    await h.refresh();
    expect(store.loads).toBe(1);
  });

  it('không đọc được bản ghi chung (DB chập) → giữ trạng thái trong bộ nhớ, không ném', async () => {
    const h = new GomdonHealth();
    h.attachStore({
      load: jest.fn().mockRejectedValue(new Error('db down')),
      recordOk: jest.fn().mockRejectedValue(new Error('db down')),
      recordRejected: jest.fn().mockRejectedValue(new Error('db down')),
    });
    await expect(h.recordError('sai mật khẩu', { credentialsRejected: true })).resolves.toBeUndefined();
    await expect(h.refresh()).resolves.toBeUndefined();
    expect(h.credentialsRejected).toBe(true);
  });

  it('lỗi mạng (không phải từ chối tài khoản) không ghi vào bản ghi chung', async () => {
    const { store, rec } = sharedStore();
    const h = new GomdonHealth();
    h.attachStore(store);
    await h.recordError('ECONNREFUSED');
    expect(rec).toEqual({ okAt: null, rejectedAt: null, rejectedMessage: null });
  });

  it('lựa chọn thu gom trên replica còn cờ cũ bật lại khi replica khác đã đăng nhập lại được', async () => {
    const { store } = sharedStore();
    const a = replica(store);
    const b = replica(store);
    const env = { GOMDON_BASE_URL: 'https://gomdon.test', GOMDON_PHONE: 'p', GOMDON_PASSWORD: 'x' } as NodeJS.ProcessEnv;
    const cfg = {
      get: jest.fn(async (k: string, fb?: unknown) => (k === GOMDON_RECYCLING_TOGGLE_KEY ? true : fb)),
    } as unknown as Pick<SystemConfigService, 'get'>;

    await a.recordError('sai mật khẩu', { credentialsRejected: true }, at('14:03:00'));
    expect(await isGomdonRecyclingEnabled(cfg, env, a)).toBe(false);
    await b.recordOk(at('14:05:38'));
    expect(await isGomdonRecyclingEnabled(cfg, env, a)).toBe(true);
  });
});
