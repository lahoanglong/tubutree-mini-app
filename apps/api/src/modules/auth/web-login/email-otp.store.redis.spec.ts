import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { RedisEmailOtpStore } from './email-otp.store';
import { EMAIL_OTP_HOURLY_PER_EMAIL, EMAIL_OTP_MAX_WRONG } from './email-otp.rules';

/**
 * Lua của RedisEmailOtpStore chạy trên Redis thật. Cần EMAIL_OTP_TEST_REDIS_URL (vd Redis tạm `docker run --rm -p 127.0.0.1:16399:6379 redis:7-alpine`);
 * không đặt thì bỏ qua, vì unit test thường không có Redis. Luật nghiệp vụ (trần, khoá sai 5 lần, dùng một lần) còn được kiểm ở
 * email-otp.service.spec.ts trên kho bộ nhớ cùng luật.
 */
const url = process.env.EMAIL_OTP_TEST_REDIS_URL;
const suite = url ? describe : describe.skip;

suite('RedisEmailOtpStore (Redis thật)', () => {
  let queue: Queue;
  let store: RedisEmailOtpStore;
  const slot = () => ({ id: randomUUID().replace(/-/g, ''), ip: `ip-${randomUUID()}`, day: `d-${randomUUID()}` });

  beforeAll(() => {
    queue = new Queue(`eotp-test-${randomUUID()}`, { connection: { url: url! } });
    store = new RedisEmailOtpStore(queue);
  });
  afterAll(async () => {
    await queue.close();
  });

  it('cấp mã, đúng thì xoá (dùng lại → missing)', async () => {
    const s = slot();
    expect(await store.start({ ...s, codeHash: 'h1' })).toEqual({ ok: true });
    expect(await store.verify(s.id, 'h1')).toEqual({ kind: 'ok' });
    expect(await store.verify(s.id, 'h1')).toEqual({ kind: 'missing' });
  });

  it('chờ gửi lại: lần thứ hai trong 60 giây bị từ chối, kèm thời gian còn lại', async () => {
    const s = slot();
    await store.start({ ...s, codeHash: 'h1' });
    const r = await store.start({ ...s, codeHash: 'h2' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('cooldown');
      expect(r.retryAfterMs).toBeGreaterThan(55_000);
      expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
    expect(await store.verify(s.id, 'h1')).toEqual({ kind: 'ok' });
  });

  it(`sai ${EMAIL_OTP_MAX_WRONG - 1} lần đếm ngược, lần thứ ${EMAIL_OTP_MAX_WRONG} khoá; mã đúng sau đó không dùng được`, async () => {
    const s = slot();
    await store.start({ ...s, codeHash: 'good' });
    for (let left = EMAIL_OTP_MAX_WRONG - 1; left >= 1; left--) expect(await store.verify(s.id, 'bad')).toEqual({ kind: 'wrong', attemptsLeft: left });
    expect(await store.verify(s.id, 'bad')).toEqual({ kind: 'locked' });
    expect(await store.verify(s.id, 'good')).toEqual({ kind: 'missing' });
  });

  it('xác minh song song cùng mã: đúng một lần ok', async () => {
    const s = slot();
    await store.start({ ...s, codeHash: 'h' });
    const out = await Promise.all(Array.from({ length: 8 }, () => store.verify(s.id, 'h')));
    expect(out.filter((r) => r.kind === 'ok')).toHaveLength(1);
  });

  it(`trần ${EMAIL_OTP_HOURLY_PER_EMAIL}/giờ theo email; cancel trả lại lượt và xoá thời gian chờ`, async () => {
    const s = slot();
    const client = (await queue.client) as unknown as { del(...k: string[]): Promise<number> };
    for (let i = 0; i < EMAIL_OTP_HOURLY_PER_EMAIL; i++) {
      expect((await store.start({ ...s, ip: `ip-${i}-${s.ip}`, codeHash: `h${i}` })).ok).toBe(true);
      await client.del(`tubu:auth:eotp:cd:${s.id}`);
    }
    const over = await store.start({ ...s, codeHash: 'x' });
    expect(over).toMatchObject({ ok: false, reason: 'email_hourly' });
    await store.cancel(s);
    expect(await store.verify(s.id, `h${EMAIL_OTP_HOURLY_PER_EMAIL - 1}`)).toEqual({ kind: 'missing' });
    expect((await store.start({ ...s, codeHash: 'again' })).ok).toBe(true);
  });

  it('khoá mã có hạn (PTTL) ≤ 10 phút, bộ đếm có hạn', async () => {
    const s = slot();
    await store.start({ ...s, codeHash: 'h' });
    const client = (await queue.client) as unknown as { pttl(k: string): Promise<number> };
    const codeTtl = await client.pttl(`tubu:auth:eotp:c:${s.id}`);
    expect(codeTtl).toBeGreaterThan(9 * 60_000);
    expect(codeTtl).toBeLessThanOrEqual(10 * 60_000);
    expect(await client.pttl(`tubu:auth:eotp:he:${s.id}`)).toBeGreaterThan(0);
    expect(await client.pttl(`tubu:auth:eotp:hi:${s.ip}`)).toBeGreaterThan(0);
    expect(await client.pttl(`tubu:auth:eotp:d:${s.day}`)).toBeGreaterThan(0);
  });
});
