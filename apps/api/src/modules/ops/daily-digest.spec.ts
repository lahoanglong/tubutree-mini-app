import { Logger } from '@nestjs/common';
import { digestDayFor, digestDayLabel, digestDayRange, type DailyDigest } from './daily-digest';
import { dailyDigestEmail } from './ops-email';
import { OpsEmailService, type MailTransport } from './ops-email.service';

const CTX = { appName: 'Tubu Tree', envLabel: 'production' };

const FULL: DailyDigest = {
  day: '2026-11-23',
  generatedAt: '2026-11-24T01:00:00.000Z',
  orders: { placed: 12, cancelled: 1, paidOrders: 8, revenue: 3_450_000, gmv: 4_100_000 },
  unpaidTransfers: { count: 7, amount: 1_200_000, oldest: [{ code: 'TB1001', createdAt: '2026-11-23T07:05:00.000Z', total: 400_000 }] },
  stuckOrders: { count: 2, oldest: [{ code: 'TB0900', status: 'PACKED', since: '2026-11-21T02:00:00.000Z' }] },
  lowStock: { count: 3, outOfStock: 1, items: [{ sku: 'SKU-1', name: 'Nước rửa chén <500ml>', stock: 0 }] },
  zeroResults: [{ term: 'dau goi bo ket', count: 7 }],
  serverErrors: 5,
};

describe('mốc ngày của bản tin', () => {
  it('hôm qua theo giờ VN, kể cả khi giờ UTC còn ở ngày trước', () => {
    // 08:00 VN 24/11 = 01:00 UTC 24/11; 00:30 VN 24/11 = 17:30 UTC 23/11.
    expect(digestDayFor(new Date('2026-11-24T01:00:00.000Z'))).toBe('2026-11-23');
    expect(digestDayFor(new Date('2026-11-23T17:30:00.000Z'))).toBe('2026-11-23');
    expect(digestDayFor(new Date('2026-12-01T01:00:00.000Z'))).toBe('2026-11-30');
  });

  it('khung ngày là [00:00, 24:00) giờ VN; nhãn dd/mm/yyyy', () => {
    expect(digestDayRange('2026-11-23')).toEqual({ start: new Date('2026-11-22T17:00:00.000Z'), end: new Date('2026-11-23T17:00:00.000Z') });
    expect(digestDayLabel('2026-11-23')).toBe('23/11/2026');
  });
});

describe('dailyDigestEmail', () => {
  it('tiêu đề nêu ngày, số đơn và doanh thu; thân có đủ sáu mục ở cả văn bản lẫn HTML', () => {
    const m = dailyDigestEmail(FULL, CTX);
    expect(m.subject).toBe('[Tubu Tree · production] Bản tin sáng 23/11: 12 đơn, doanh thu 3.450.000đ');
    for (const body of [m.text, m.html]) {
      expect(body).toContain('Bản tin sáng: số liệu ngày 23/11/2026');
      expect(body).toContain('Đơn đặt: 12 (nay đã huỷ hoặc trả: 1).');
      expect(body).toContain('Doanh thu đã thu: 3.450.000đ từ 8 đơn.');
      expect(body).toContain('7 đơn chờ chuyển khoản, tổng 1.200.000đ.');
      expect(body).toContain('TB1001: 400.000đ, đặt lúc 14:05 23/11/2026.');
      expect(body).toContain('Và 6 đơn khác.');
      expect(body).toContain('Đơn kho Tubu kẹt quá 48 giờ');
      expect(body).toContain('TB0900: đã đóng gói từ 09:00 21/11/2026.');
      expect(body).toContain('3 mã hàng, trong đó 1 mã đã hết.');
      expect(body).toContain('dau goi bo ket');
      expect(body).toContain('5 lượt trả lỗi 5xx.');
    }
    expect(m.text).toContain('Nước rửa chén <500ml> (SKU-1): còn 0.');
    expect(m.html).toContain('Nước rửa chén &lt;500ml&gt; (SKU-1): còn 0.');
    expect(m.html).not.toContain('<500ml>');
    expect(m.text).toContain('Gửi lúc 08:00 24/11/2026');
  });

  it('mục lỗi truy vấn ghi rõ là chưa đọc được (không in 0 hay undefined); tiêu đề bỏ số khi thiếu mục đơn', () => {
    const m = dailyDigestEmail(
      { ...FULL, orders: null, unpaidTransfers: null, stuckOrders: null, lowStock: null, zeroResults: null, serverErrors: null },
      CTX,
    );
    expect(m.subject).toBe('[Tubu Tree · production] Bản tin sáng 23/11');
    expect(m.text.match(/Chưa đọc được số liệu mục này/g)).toHaveLength(6);
    expect(m.text).not.toMatch(/undefined|null|NaN/);
  });

  it('ngày yên ổn: câu "không có" thay vì danh sách rỗng', () => {
    const m = dailyDigestEmail(
      {
        ...FULL,
        orders: { placed: 0, cancelled: 0, paidOrders: 0, revenue: 0, gmv: 0 },
        unpaidTransfers: { count: 0, amount: 0, oldest: [] },
        stuckOrders: { count: 0, oldest: [] },
        lowStock: { count: 0, outOfStock: 0, items: [] },
        zeroResults: [],
        serverErrors: 0,
      },
      CTX,
    );
    expect(m.subject).toContain('0 đơn, doanh thu 0đ');
    expect(m.text).toContain('Không có đơn nào chờ chuyển khoản.');
    expect(m.text).toContain('Không có đơn nào đã xác nhận hoặc đóng gói mà đứng yên quá 48 giờ.');
    expect(m.text).toContain('Không có mã hàng nào.');
    expect(m.text).toContain('Không có lượt tìm nào ra trống.');
    expect(m.text).toContain('Lỗi máy chủ (5xx)\n• Không có lượt nào.');
  });

  it('tên hàng và cụm tìm dài bị cắt gọn, không đẩy cả chuỗi vào thư', () => {
    const m = dailyDigestEmail(
      { ...FULL, lowStock: { count: 1, outOfStock: 0, items: [{ sku: 'S', name: 'Tên rất dài '.repeat(20), stock: 2 }] }, zeroResults: [{ term: 'x'.repeat(80), count: 1 }] },
      CTX,
    );
    const stockLine = m.text.split('\n').find((l) => l.includes('(S): còn 2.'))!;
    expect(stockLine.length).toBeLessThan(90);
    expect(m.text).not.toContain('x'.repeat(41));
  });
});

describe('OpsEmailService.sendDigest', () => {
  const ENV: Record<string, string> = {
    OPS_ALERT_EMAIL_TO: 'owner@tubutree.com',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'mailer-user',
    SMTP_PASS: 'hunter2-pass',
    SMTP_FROM: 'Tubu Tree <alerts@tubutree.com>',
    NODE_ENV: 'production',
  };

  function setup(env: Record<string, string>, sendMail: MailTransport['sendMail'] = jest.fn(async () => ({}))) {
    const t = { sendMail: jest.fn(sendMail), close: jest.fn() };
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = {
      opsHealthState: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null),
        upsert: jest.fn(async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          rows.set(where.key, { ...(rows.get(where.key) ?? create), ...update });
        }),
      },
    };
    const svc = new OpsEmailService({ get: (k: string) => env[k] ?? '' } as never, prisma as never, (() => t) as never);
    return { svc, t, rows };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('chưa cấu hình: NOT_READY, isReady false, không nối SMTP', async () => {
    const { svc, t } = setup({});
    expect(svc.isReady()).toBe(false);
    await expect(svc.sendDigest(FULL)).resolves.toBe('NOT_READY');
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('đủ cấu hình: gửi một thư tới người nhận báo động, ghi lần gửi thành công của kênh', async () => {
    const { svc, t, rows } = setup(ENV);
    expect(svc.isReady()).toBe(true);
    await expect(svc.sendDigest(FULL)).resolves.toBe('SENT');
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    const msg = t.sendMail.mock.calls[0]![0];
    expect(msg.to).toEqual(['owner@tubutree.com']);
    expect(msg.subject).toContain('Bản tin sáng 23/11');
    expect(msg.headers['Auto-Submitted']).toBe('auto-generated');
    expect(rows.get('alert.email')?.lastOkAt).toBeInstanceOf(Date);
  });

  it('lỗi tạm thời → RETRY; sai xác thực → BLOCKED và ghi khoá chặn của kênh', async () => {
    const transient = setup(ENV, jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    await expect(transient.svc.sendDigest(FULL)).resolves.toBe('RETRY');
    const auth = setup(ENV, jest.fn().mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })));
    await expect(auth.svc.sendDigest(FULL)).resolves.toBe('BLOCKED');
    expect(auth.rows.get('alert.email.block')?.detail).toMatchObject({ kind: 'AUTH' });
  });
});
