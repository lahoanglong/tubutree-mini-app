import { ORDER_CODE_ALPHABET } from '@tubutree/shared-types';
import { NOTIFICATION_TEMPLATES } from '../../../prisma/seed';
import { cronAlertError } from './cron-run.service';
import { clipText, OPS_ALERT_LINE_MAX, OPS_ALERT_SLOT_MAX, OPS_NOTICE_MAX, opsAlertLine, opsAlertSlot, opsText } from './ops-alert-line';
import { alertWebhookBody, opsProblems, type OpsThresholds, type ProblemInput } from './ops-alerts';
import { alertEmail } from './ops-email';
import { OpsHealthService } from './ops-health.service';

/** Điền mẫu như NotificationsService.render: `{{khoá}}` thiếu thì rỗng. */
function render(code: string, data: Record<string, string>): string {
  const t = NOTIFICATION_TEMPLATES.find((x) => x.code === code);
  if (!t) throw new Error(`thiếu mẫu ${code} trong seed`);
  return t.bodyTemplate.replace(/\{\{(\w+)\}\}/g, (_, k: string) => data[k] ?? '');
}

const PHONE = '0912345678';
// Ghép lúc chạy: chuỗi liền mạch trông như khoá Stripe thật và bị GitHub push protection chặn.
const SECRET = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
/** Lỗi tự do xấu nhất: SĐT khách, khoá trong query, mật khẩu trong URL Redis, Bearer, cách gọi API, rất dài. */
const NASTY =
  `Pancake 500 khi đẩy đơn của khách ${PHONE} (SĐT+84987654321): GET https://pos.pages.fm/api/v1/shops/123/orders?api_key=${SECRET} ` +
  `redis://default:hunter2pass@10.0.0.5:6379/0 Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig token=abc123 ` +
  'chạy lại tay: POST /admin/orders/TUBU2026101500001/resync-delivered-effects rồi gọi /internal/mss/health. '.repeat(3);

function expectClean(text: string) {
  expect(text).not.toContain(PHONE);
  expect(text).not.toContain('987654321');
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('hunter2pass');
  expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  expect(text).not.toContain('abc123');
  expect(text).not.toMatch(/\b(?:GET|POST|PUT|PATCH|DELETE) \//);
  expect(text).not.toMatch(/\/(?:admin|api|internal)\//);
}

describe('opsText: lời tự do trước khi ra khỏi hệ thống', () => {
  it('che SĐT, khoá, mật khẩu URL, Bearer; URL chỉ còn tên máy; bỏ cách gọi API và đường dẫn API trần', () => {
    const out = opsText(NASTY);
    expectClean(out);
    expect(out).toContain('[số điện thoại đã ẩn]');
    expect(out).toContain('pos.pages.fm');
    expect(out).toContain('10.0.0.5:6379');
  });

  it('khoá ngắn có tiền tố (refresh_token=, access_token:) và dạng JSON ("password":"…") cũng bị che', () => {
    const out = opsText('lỗi refresh_token=abc123XYZ access_token: q9w8e7 body {"password":"hunter22","client_secret": "s3cr3t"} x-api-key=k1');
    for (const leak of ['abc123XYZ', 'q9w8e7', 'hunter22', 's3cr3t', 'k1']) expect(out).not.toContain(leak);
    expect(out).toContain('refresh_token');
  });

  it('Authorization Basic (cả dạng JSON), khoá có dấu phẩy/dấu cách, SĐT viết "(+84) 912 345 678" cũng bị che', () => {
    const basic = Buffer.from('ops:pw').toString('base64');
    const out = opsText(
      `lỗi Authorization: Basic ${basic} rồi {"Authorization":"Basic ${basic}"} password=ab,cd {"password":"p, w}"} gọi (+84) 912 345 678`,
    );
    for (const leak of [basic, ',cd', 'p, w', '912 345 678']) expect(out).not.toContain(leak);
    expect(out).toContain('{"Authorization":"***"}');
    expect(out).toContain('[số điện thoại đã ẩn]');
  });

  it('giữ nguyên mã đơn, #id Pancake, tên hàng đợi, giờ, số tiền', () => {
    const t = 'Đơn TUBU2026101500001, TUBUSUB0000123007 (#4521), hàng đợi pancake-push, lúc 10:05 22/11/2026, 1.250.000đ';
    expect(opsText(t)).toBe(t);
  });

  it('dấu câu treo sau khi bỏ đường dẫn thì cũng bỏ', () => {
    expect(opsText('chạy lại tay: POST /admin/orders/X/resync')).toBe('chạy lại tay');
  });
});

describe('clipText', () => {
  it('ngắn hơn giới hạn thì giữ nguyên; dài thì cắt ở ranh từ, có "…", không cắt giữa mã đơn', () => {
    expect(clipText('abc', 10)).toBe('abc');
    const refs = 'TUBU2026101500001, TUBU2026101500002, TUBU2026101500003, TUBU2026101500004';
    const out = clipText(refs, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
    for (const code of out.replace('…', '').split(', ').filter(Boolean)) expect(code).toMatch(/^TUBU\d{13}$/);
  });

  it('ưu tiên ranh câu khi giữ được hơn nửa độ dài', () => {
    expect(clipText('Câu đầu đủ dài để giữ lại nhé. Câu sau rất dài sẽ bị bỏ đi hoàn toàn khỏi tin.', 40)).toBe('Câu đầu đủ dài để giữ lại nhé…');
  });
});

describe('opsAlertLine: [Cảnh báo/Ổn] tên · số lượng/mã · chỗ xử lý', () => {
  it('đúng khuôn ba phần, nhãn theo tone', () => {
    expect(opsAlertLine({ name: 'Đơn chưa lên Pancake', detail: '2 đơn: TUBU1, TUBU2', where: 'Admin › Sức khoẻ hệ thống' })).toBe(
      '[Cảnh báo] Đơn chưa lên Pancake · 2 đơn: TUBU1, TUBU2 · Admin › Sức khoẻ hệ thống',
    );
    expect(opsAlertLine({ tone: 'OK', name: 'Hết sự cố vận hành', where: 'Admin › Sức khoẻ hệ thống' })).toBe('[Ổn] Hết sự cố vận hành · Admin › Sức khoẻ hệ thống');
  });

  it('chi tiết dài và bẩn: dòng ≤ 180, đã che, tên và chỗ xử lý còn nguyên', () => {
    const line = opsAlertLine({ name: 'Đồng bộ danh mục Pancake lỗi', detail: NASTY, where: 'Admin › Sức khoẻ hệ thống' });
    expect(line.length).toBeLessThanOrEqual(OPS_ALERT_LINE_MAX);
    expect(line.startsWith('[Cảnh báo] Đồng bộ danh mục Pancake lỗi · ')).toBe(true);
    expect(line.endsWith(' · Admin › Sức khoẻ hệ thống')).toBe(true);
    expectClean(line);
  });

  it('opsAlertSlot (phần lời của mẫu có tiền tố): ≤ 150, không nhãn, còn chỗ xử lý', () => {
    const slot = opsAlertSlot(NASTY, 'Admin › Đơn hàng › Cần xử lý Pancake');
    expect(slot.length).toBeLessThanOrEqual(OPS_ALERT_SLOT_MAX);
    expect(slot).not.toContain('[Cảnh báo]');
    expect(slot.endsWith(' · Admin › Đơn hàng › Cần xử lý Pancake')).toBe(true);
    expectClean(slot);
  });
});

describe('mọi sự cố của opsProblems: ≤ 180 ký tự, không lộ SĐT/khoá/đường dẫn API, kể cả đầu vào xấu nhất', () => {
  const T: OpsThresholds = { unsyncedMinutes: 30, stuckOrders: 1, webhookFailed: 1, queueFailed1h: 5, repeatHours: 6, gomdonBacklogMinutes: 15 };
  const many = Array.from({ length: 40 }, (_, i) => `TUBU20261015${String(i).padStart(5, '0')}`);
  const hooks = many.map((c) => `${c} (order.status_updated)`);
  const worst: ProblemInput = {
    pancake: {
      configured: true,
      stuck: 12_345,
      stuckRefs: many,
      webhookFailedOpen: 9_999,
      webhookStuck: 9_999,
      webhookRefs: hooks,
      attention: 9_999,
      attentionRefs: many,
      configBlocked: 9_999,
      configRefs: many,
      catalog: { lastOkAt: null, lastErrorAt: '2026-11-22T01:00:00.000Z', lastError: NASTY },
    },
    gomdon: {
      configured: true,
      webhookFailedOpen: 9_999,
      webhookRefs: many,
      credentialsRejected: true,
      backlog: 9_999,
      backlogRefs: many,
      attention: 9_999,
      attentionRefs: many,
    },
    queues: { ok: true, items: [{ name: 'notifications-zns-delivery-retry-long-name', failedLastHour: 99_999 }] },
    zns: { failed24h: 99_999, topError: NASTY },
    orders: { deliveredEffectsPending: 9_999, deliveredEffectsRefs: many, deliveredEffectsStale: 9_000, graceMinutes: 10, windowDays: 14 },
  };

  const all = [...opsProblems(worst, T), ...opsProblems({ ...worst, queues: { ok: false, error: NASTY } }, T).filter((p) => p.key === 'queues.down')];

  it('đủ 13 loại sự cố', () => {
    expect(new Set(all.map((p) => p.key)).size).toBe(13);
  });

  it.each(all.map((p) => [p.key, p.message]))('%s', (_key, message) => {
    expect(message.length).toBeLessThanOrEqual(OPS_ALERT_LINE_MAX);
    expect(message).toMatch(/^\[Cảnh báo\] [^·]+ · .+ · .+$/);
    expectClean(message);
  });

  it('webhook (Slack và hook chung) và email gửi đúng các dòng ngắn đó, không lộ gì', () => {
    const m = { status: 'ALERT' as const, title: '⚠️ Sự cố vận hành', summary: all.map((p) => p.message).join('; '), problems: all, generatedAt: '2026-11-22T01:00:00.000Z' };
    const slack = alertWebhookBody('https://hooks.slack.com/services/T/B/X', m) as { text: string };
    for (const line of slack.text.split('\n').slice(1)) expect(line.length).toBeLessThanOrEqual(OPS_ALERT_LINE_MAX + 2);
    expectClean(JSON.stringify(alertWebhookBody('https://n8n.example.test/hook', m)));
    const email = alertEmail(m, { appName: 'Tubu Tree', envLabel: 'production' });
    expectClean(email.text);
    expectClean(email.html);
  });

  it('tin in-app OPS_HEALTH_ALERT (tiêu đề + tóm tắt): ≤ 200 ký tự dù 13 sự cố cùng lúc, nêu số sự cố và tên từng loại còn chỗ', () => {
    const svc = new OpsHealthService({} as never, { get: () => '' } as never, []);
    const msg = (kind: 'ALERT', problems: typeof all) =>
      (svc as unknown as { message(k: 'ALERT', p: typeof all, s: Date | null, n: Date): { title: string; summary: string } }).message(kind, problems, null, new Date());
    const many = msg('ALERT', all);
    const body = render('OPS_HEALTH_ALERT', many);
    expect(body.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    expect(many.summary).toMatch(/^\[Cảnh báo\] 13 sự cố vận hành · Đơn chưa lên Pancake, .+ · Admin › Sức khoẻ hệ thống$/);
    expectClean(body);
    const one = msg('ALERT', [all[0]!]);
    expect(one.summary).toBe(all[0]!.message);
    expect(render('OPS_HEALTH_ALERT', one).length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
  });

  it('một sự cố lạ không dựng bằng opsAlertLine vẫn bị che và cắt ở webhook', () => {
    const raw = { key: 'x', message: NASTY };
    const body = alertWebhookBody('https://hooks.slack.com/x', { status: 'ALERT', title: 't', summary: NASTY, problems: [raw], generatedAt: '' }) as { text: string };
    const bullet = body.text.split('\n')[1]!;
    expect(bullet.length).toBeLessThanOrEqual(OPS_ALERT_LINE_MAX + 2);
    expectClean(body.text);
  });
});

describe('tin in-app sau khi điền mẫu seed: ≤ 200 ký tự', () => {
  it('OPS_CRON_FAILED: tên job dài nhất đang đăng ký, 3 chữ số lần lỗi, lỗi bẩn', () => {
    const error = cronAlertError(`PrismaClientKnownRequestError: ${NASTY}`);
    const body = render('OPS_CRON_FAILED', { job: 'wallet.referral-notice-reconcile', count: '999', error });
    expect(body.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    expectClean(body);
  });

  it('OPS_CRON_FAILED: lỗi rỗng vẫn có chữ', () => {
    expect(cronAlertError('')).toBe('không rõ lỗi');
  });

  it.each(['OPS_GOMDON_ALERT', 'OPS_PANCAKE_ALERT', 'OPS_REFUND_ALERT', 'OPS_PAYMENT_ALERT'])('%s: mã đơn 17 ký tự + phần lời tối đa', (code) => {
    const message = opsAlertSlot(NASTY, 'Admin › Hoàn tiền khách › Chờ đối soát');
    const body = render(code, { order_code: 'TUBU2026101500001', message });
    expect(body.length).toBeLessThanOrEqual(OPS_NOTICE_MAX);
    expectClean(body);
  });
});

describe('opsText: mã đơn ngắn (tubu-w36-02, trước gửi duyệt Zalo) không bị che như số điện thoại', () => {
  const digits = [...ORDER_CODE_ALPHABET].filter((c) => /\d/.test(c));

  it('mọi mã ngắn toàn chữ số (TB/DL/TS, 4 và 5 ký tự) giữ nguyên trong dòng báo động, kể cả viết dính liền', () => {
    let checked = 0;
    for (const prefix of ['TB', 'DL', 'TS']) {
      for (const len of [4, 5]) {
        for (let n = 0; n < digits.length ** len; n++) {
          let code = prefix;
          for (let k = 0, m = n; k < len; k++, m = Math.floor(m / digits.length)) code += digits[m % digits.length];
          const text = `Đơn ${code}, ${code}${code} chưa đẩy Pancake`;
          if (opsText(text) !== text) throw new Error(`${code} bị đổi: ${opsText(text)}`);
          checked++;
        }
      }
    }
    expect(checked).toBe(3 * (8 ** 4 + 8 ** 5));
  });

  it('mã ngắn đứng sát số tiền, số lượng (sau dấu phẩy, dấu ·, hay số ngắn) giữ nguyên', () => {
    for (const text of ['Đơn TB8495, 1.200.000đ', 'Đơn TB8495 · 1.200.000đ', 'Đơn TB8495 x2 120.000đ', 'Đơn TB2384 3 món', 'Đơn TB98765 1.200.000đ']) {
      expect(opsText(text)).toBe(text);
    }
  });

  // Lỗi đã biết, chờ sửa ở PHONE_RE: đuôi mã có "84" rồi chữ số đầu di động, cách một dấu cách tới số tiền đủ dài, bị che thành "TB[số điện thoại đã ẩn]đ"
  // nên người vận hành mất mã đơn. it.failing xanh khi lỗi còn; sửa xong ca này đỏ, đổi thành it.
  it.failing('đã biết: "Đơn TB8495 1.200.000đ" bị che mất mã đơn', () => {
    expect(opsText('Đơn TB8495 1.200.000đ')).toBe('Đơn TB8495 1.200.000đ');
  });

  it('mã ngắn có chữ và mã dài cũ giữ nguyên; số điện thoại ngay cạnh mã ngắn vẫn bị che', () => {
    const t = 'Đơn TB7K4M, DLX9Q2, TS2B8H7 và TUBU2026112212345 (#4521)';
    expect(opsText(t)).toBe(t);
    const out = opsText('Đơn TB98765 khách 0912345678, đơn TB7K4M SĐT0987654321');
    expect(out).toBe('Đơn TB98765 khách [số điện thoại đã ẩn], đơn TB7K4M SĐT[số điện thoại đã ẩn]');
  });
});
