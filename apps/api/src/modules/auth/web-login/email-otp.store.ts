import type { Queue } from 'bullmq';
import { withQueueTimeout } from '../../../jobs/queue-timeout';
import {
  EMAIL_OTP_DAILY_PER_IP,
  EMAIL_OTP_DAILY_TOTAL,
  EMAIL_OTP_DAY_MS,
  EMAIL_OTP_HOUR_MS,
  EMAIL_OTP_HOURLY_PER_EMAIL,
  EMAIL_OTP_HOURLY_PER_IP,
  EMAIL_OTP_MAX_WRONG,
  EMAIL_OTP_RESEND_COOLDOWN_MS,
  EMAIL_OTP_TTL_MS,
  EMAIL_OTP_WRONG_PER_HOUR,
} from './email-otp.rules';

export type EmailOtpLimit = 'cooldown' | 'email_hourly' | 'ip_hourly' | 'ip_daily' | 'daily_cap';
export type EmailOtpStartResult = { ok: true } | { ok: false; reason: EmailOtpLimit; retryAfterMs: number };
export type EmailOtpVerifyResult = { kind: 'ok' } | { kind: 'wrong'; attemptsLeft: number } | { kind: 'locked' } | { kind: 'missing' };

export interface EmailOtpStartInput {
  /** emailIdentityHash của hộp thư. */
  id: string;
  /** Khoá IP đã gom (throttleIpKey). */
  ip: string;
  /** Ngày theo giờ máy chủ (YYYY-MM-DD) cho trần thư mỗi ngày. */
  day: string;
  codeHash: string;
}

/**
 * Kho mã đăng nhập email: mỗi thao tác là MỘT lệnh nguyên tử, nên hai lần xác minh đồng thời cùng mã chỉ một lần thắng (mã dùng
 * một lần) và lần đoán sai thứ 5 xoá mã ngay trong cùng lệnh.
 */
export interface EmailOtpStore {
  /** Kiểm trần (chờ gửi lại, lượt sai trong giờ, theo email, theo IP, theo ngày) rồi mới cất mã mới thay mã cũ; vượt trần thì không đổi gì. */
  start(input: EmailOtpStartInput): Promise<EmailOtpStartResult>;
  /** Gửi thư thất bại: xoá mã và thời gian chờ, trả lại lượt đếm để khách bấm gửi lại được ngay. */
  cancel(input: Omit<EmailOtpStartInput, 'codeHash'>): Promise<void>;
  verify(id: string, codeHash: string): Promise<EmailOtpVerifyResult>;
}

export const EMAIL_OTP_STORE = Symbol('EMAIL_OTP_STORE');

const PREFIX = 'tubu:auth:eotp';
const wrongKey = (id: string) => `${PREFIX}:wh:${id}`;
const keys = (i: Omit<EmailOtpStartInput, 'codeHash'>) => [
  `${PREFIX}:c:${i.id}`,
  `${PREFIX}:cd:${i.id}`,
  `${PREFIX}:he:${i.id}`,
  `${PREFIX}:hi:${i.ip}`,
  `${PREFIX}:d:${i.day}`,
  `${PREFIX}:di:${i.day}:${i.ip}`,
  wrongKey(i.id),
];

// KEYS: mã, chờ gửi lại, đếm giờ theo email, đếm giờ theo IP, đếm ngày, đếm ngày theo IP, lượt sai trong giờ theo email.
// Bộ đếm thiếu hạn (PTTL -1) được đặt lại hạn để không kẹt mãi.
const START_LUA = `
local cd = redis.call('PTTL', KEYS[2])
if cd > 0 then return {'cooldown', cd} end
local function over(key, max)
  local n = tonumber(redis.call('GET', key) or '0')
  if n >= max then
    local t = redis.call('PTTL', key)
    if t < 0 then t = 0 end
    return t
  end
  return false
end
local t = over(KEYS[7], tonumber(ARGV[10]))
if t then return {'email_hourly', t} end
t = over(KEYS[3], tonumber(ARGV[6]))
if t then return {'email_hourly', t} end
t = over(KEYS[4], tonumber(ARGV[7]))
if t then return {'ip_hourly', t} end
t = over(KEYS[6], tonumber(ARGV[9]))
if t then return {'ip_daily', t} end
t = over(KEYS[5], tonumber(ARGV[8]))
if t then return {'daily_cap', t} end
local function bump(key, ttl)
  local n = redis.call('INCR', key)
  if n == 1 or redis.call('PTTL', key) < 0 then redis.call('PEXPIRE', key, ttl) end
end
bump(KEYS[3], ARGV[4])
bump(KEYS[4], ARGV[4])
bump(KEYS[5], ARGV[5])
bump(KEYS[6], ARGV[5])
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'h', ARGV[1], 'n', '0')
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
return {'ok', 0}
`;

const CANCEL_LUA = `
redis.call('DEL', KEYS[1], KEYS[2])
for i = 3, 6 do
  local n = tonumber(redis.call('GET', KEYS[i]) or '0')
  if n > 0 then redis.call('DECR', KEYS[i]) end
end
return 1
`;

// KEYS: mã, lượt sai trong giờ theo email. ARGV: băm khách gửi, số lần sai tối đa của một mã, hạn bộ đếm giờ.
// Đúng thì xoá (dùng một lần); sai thì cộng cả hai bộ đếm, sai lần thứ max của mã thì xoá (khoá mã này).
const VERIFY_LUA = `
local h = redis.call('HGET', KEYS[1], 'h')
if not h then return {'missing', 0} end
if h == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'ok', 0}
end
local w = redis.call('INCR', KEYS[2])
if w == 1 or redis.call('PTTL', KEYS[2]) < 0 then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
local n = redis.call('HINCRBY', KEYS[1], 'n', 1)
local max = tonumber(ARGV[2])
if n >= max then
  redis.call('DEL', KEYS[1])
  return {'locked', 0}
end
return {'wrong', max - n}
`;

/** Phần ioredis cần ở đây; client của BullMQ chuyển tiếp lệnh sang ioredis nhưng không khai báo kiểu cho EVAL. */
interface RedisEval {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const REDIS_TIMEOUT_MS = 2_000;

function pair(raw: unknown): [string, number] {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string') throw new Error('Redis trả kết quả không đúng dạng (email OTP)');
  return [raw[0], Number(raw[1]) || 0];
}

/** Chạy trên kết nối Redis sẵn có của BullMQ (không mở kết nối mới), mỗi lệnh có hạn chờ như mọi lệnh Redis trên đường request. */
export class RedisEmailOtpStore implements EmailOtpStore {
  constructor(private readonly queue: Pick<Queue, 'client'>) {}

  private run(label: string, script: string, keyList: string[], args: (string | number)[]): Promise<unknown> {
    return withQueueTimeout(
      this.queue.client.then((c) => (c as unknown as RedisEval).eval(script, keyList.length, ...keyList, ...args)),
      `email-otp:${label}`,
      REDIS_TIMEOUT_MS,
    );
  }

  async start(input: EmailOtpStartInput): Promise<EmailOtpStartResult> {
    const [kind, ms] = pair(
      await this.run('start', START_LUA, keys(input), [
        input.codeHash,
        EMAIL_OTP_TTL_MS,
        EMAIL_OTP_RESEND_COOLDOWN_MS,
        EMAIL_OTP_HOUR_MS,
        EMAIL_OTP_DAY_MS,
        EMAIL_OTP_HOURLY_PER_EMAIL,
        EMAIL_OTP_HOURLY_PER_IP,
        EMAIL_OTP_DAILY_TOTAL,
        EMAIL_OTP_DAILY_PER_IP,
        EMAIL_OTP_WRONG_PER_HOUR,
      ]),
    );
    if (kind === 'ok') return { ok: true };
    if (kind === 'cooldown' || kind === 'email_hourly' || kind === 'ip_hourly' || kind === 'ip_daily' || kind === 'daily_cap') return { ok: false, reason: kind, retryAfterMs: ms };
    throw new Error(`Redis trả kết quả lạ (email OTP start): ${kind}`);
  }

  async cancel(input: Omit<EmailOtpStartInput, 'codeHash'>): Promise<void> {
    await this.run('cancel', CANCEL_LUA, keys(input), []);
  }

  async verify(id: string, codeHash: string): Promise<EmailOtpVerifyResult> {
    const [kind, n] = pair(await this.run('verify', VERIFY_LUA, [`${PREFIX}:c:${id}`, wrongKey(id)], [codeHash, EMAIL_OTP_MAX_WRONG, EMAIL_OTP_HOUR_MS]));
    if (kind === 'ok' || kind === 'locked' || kind === 'missing') return { kind };
    if (kind === 'wrong') return { kind, attemptsLeft: n };
    throw new Error(`Redis trả kết quả lạ (email OTP verify): ${kind}`);
  }
}

/**
 * Cùng luật với RedisEmailOtpStore nhưng trong bộ nhớ một tiến trình, đồng hồ tiêm được; chỉ dùng trong test (production luôn dùng Redis).
 * JS đơn luồng nên mỗi hàm chạy trọn không xen kẽ, giữ được tính nguyên tử như Lua.
 */
export class MemoryEmailOtpStore implements EmailOtpStore {
  private readonly values = new Map<string, { v: string; n: number; until: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.values.get(key);
    if (e && e.until <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return e;
  }

  private ttl(key: string): number {
    const e = this.live(key);
    return e ? e.until - this.now() : 0;
  }

  private count(key: string): number {
    return this.live(key)?.n ?? 0;
  }

  private bump(key: string, ttlMs: number) {
    const e = this.live(key);
    if (e) e.n += 1;
    else this.values.set(key, { v: '', n: 1, until: this.now() + ttlMs });
  }

  async start(input: EmailOtpStartInput): Promise<EmailOtpStartResult> {
    const [c, cd, he, hi, d, di, wh] = keys(input) as [string, string, string, string, string, string, string];
    const wait = this.ttl(cd);
    if (wait > 0) return { ok: false, reason: 'cooldown', retryAfterMs: wait };
    if (this.count(wh) >= EMAIL_OTP_WRONG_PER_HOUR) return { ok: false, reason: 'email_hourly', retryAfterMs: this.ttl(wh) };
    if (this.count(he) >= EMAIL_OTP_HOURLY_PER_EMAIL) return { ok: false, reason: 'email_hourly', retryAfterMs: this.ttl(he) };
    if (this.count(hi) >= EMAIL_OTP_HOURLY_PER_IP) return { ok: false, reason: 'ip_hourly', retryAfterMs: this.ttl(hi) };
    if (this.count(di) >= EMAIL_OTP_DAILY_PER_IP) return { ok: false, reason: 'ip_daily', retryAfterMs: this.ttl(di) };
    if (this.count(d) >= EMAIL_OTP_DAILY_TOTAL) return { ok: false, reason: 'daily_cap', retryAfterMs: this.ttl(d) };
    this.bump(he, EMAIL_OTP_HOUR_MS);
    this.bump(hi, EMAIL_OTP_HOUR_MS);
    this.bump(d, EMAIL_OTP_DAY_MS);
    this.bump(di, EMAIL_OTP_DAY_MS);
    this.values.set(c, { v: input.codeHash, n: 0, until: this.now() + EMAIL_OTP_TTL_MS });
    this.values.set(cd, { v: '1', n: 0, until: this.now() + EMAIL_OTP_RESEND_COOLDOWN_MS });
    return { ok: true };
  }

  async cancel(input: Omit<EmailOtpStartInput, 'codeHash'>): Promise<void> {
    const [c, cd, he, hi, d, di] = keys(input) as [string, string, string, string, string, string];
    this.values.delete(c);
    this.values.delete(cd);
    for (const k of [he, hi, d, di]) {
      const e = this.live(k);
      if (e && e.n > 0) e.n -= 1;
    }
  }

  async verify(id: string, codeHash: string): Promise<EmailOtpVerifyResult> {
    const key = `${PREFIX}:c:${id}`;
    const e = this.live(key);
    if (!e) return { kind: 'missing' };
    if (e.v === codeHash) {
      this.values.delete(key);
      return { kind: 'ok' };
    }
    this.bump(wrongKey(id), EMAIL_OTP_HOUR_MS);
    e.n += 1;
    if (e.n >= EMAIL_OTP_MAX_WRONG) {
      this.values.delete(key);
      return { kind: 'locked' };
    }
    return { kind: 'wrong', attemptsLeft: EMAIL_OTP_MAX_WRONG - e.n };
  }
}
