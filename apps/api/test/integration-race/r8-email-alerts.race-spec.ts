import { PrismaService } from '../../src/prisma/prisma.service';
import { OpsHealthService, type OpsQueue } from '../../src/modules/ops/ops-health.service';
import { OpsEmailService } from '../../src/modules/ops/ops-email.service';
import { createOrder, createUser, setConfig } from './helpers';

/**
 * r8-email-alerts trên Postgres THẬT: email là kênh thứ hai của báo động vận hành, gửi đúng những lần webhook gửi (cùng trí
 * nhớ chống báo lặp), hai kênh độc lập (SMTP lỗi không chặn webhook/cron, webhook lỗi không làm email gửi lại), lỗi SMTP
 * lộ ra ở ảnh chụp sức khoẻ mà không kèm bí mật. Hàng đợi, thông báo in-app, webhook và SMTP đều là bản giả: không có kết
 * nối hay email thật nào.
 */
describe('r8 email báo động vận hành (real Postgres)', () => {
  let prisma: PrismaService;
  let health: OpsHealthService;
  let email: OpsEmailService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const fetchMock = jest.fn();
  const sendMail = jest.fn();
  const close = jest.fn();
  let transportFactory: () => { sendMail: typeof sendMail; close: typeof close };
  const queueFailures: Record<string, number> = {};
  // Hàng đợi giả tính "lỗi trong 1 giờ qua" theo đồng hồ của lượt kiểm, không theo giờ thật (các lượt cách nhau tới nhiều giờ).
  let clockMs = Date.now();
  const fakeQueue = (name: string): OpsQueue => ({
    name,
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: queueFailures[name] ?? 0 }),
    getFailed: async () => Array.from({ length: queueFailures[name] ?? 0 }, () => ({ finishedOn: clockMs - 60_000 })),
  });
  const EMAIL_ENV = {
    OPS_ALERT_EMAIL_TO: 'ops@tubutree.test; ceo@tubutree.test',
    SMTP_HOST: 'smtp.invalid',
    SMTP_PORT: '587',
    SMTP_USER: 'mailer-user',
    SMTP_PASS: 'hunter2-pass',
    SMTP_FROM: 'Tubu Tree <alerts@tubutree.test>',
    NODE_ENV: 'test',
  };
  const env: Record<string, string> = {};
  const created: string[] = [];
  const HOOK = 'https://hooks.slack.com/services/T0/B0/XXX';
  const t0 = new Date();
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
  const check = (minutes: number) => {
    clockMs = at(minutes).getTime();
    return health.checkAndAlert(at(minutes));
  };
  const snapshotAt = (minutes: number) => {
    clockMs = at(minutes).getTime();
    return health.snapshot(at(minutes));
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const sysConfig = {
      get: async <T,>(key: string, fallback: T): Promise<T> => {
        const row = await prisma.systemConfig.findUnique({ where: { key } });
        return (row?.value as T) ?? fallback;
      },
    };
    // Pancake/Gomdon chưa cấu hình: dữ liệu đơn còn lại của spec khác trong DB dùng chung không thành sự cố, chỉ hàng đợi giả quyết định.
    const gomdon = { getConfig: async () => null, getHealth: () => null };
    const config = { get: (k: string) => env[k] ?? '' };
    email = new OpsEmailService(config as never, prisma, (() => transportFactory()) as never);
    health = new OpsHealthService(
      prisma,
      config as never,
      [fakeQueue('pancake-push'), fakeQueue('notifications')],
      sysConfig as never,
      gomdon as never,
      { notify } as never,
      fetchMock as never,
      email,
    );
    await setConfig(prisma, 'ops.alert_webhook_failed', 1);
    await setConfig(prisma, 'ops.alert_repeat_hours', 6);
    await setConfig(prisma, 'ops.alert_queue_failed_1h', 5);
    await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await prisma.order.updateMany({ where: { id: { in: created } }, data: { status: 'CANCELLED', pancakeAttention: null, pancakeAttentionAt: null } });
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    notify.mockClear();
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    sendMail.mockReset().mockResolvedValue({});
    close.mockReset();
    transportFactory = () => ({ sendMail, close });
    for (const k of Object.keys(queueFailures)) delete queueFailures[k];
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, EMAIL_ENV, { OPS_ALERT_WEBHOOK_URL: HOOK });
    await prisma.opsHealthState.deleteMany({});
    await prisma.pancakeWebhookEvent.updateMany({ where: { dismissedAt: null }, data: { dismissedAt: new Date() } });
    await prisma.gomdonWebhookEvent.updateMany({ where: { dismissedAt: null }, data: { dismissedAt: new Date() } });
    await prisma.order.updateMany({ where: { status: 'DELIVERED', deliveredEffectsAt: null }, data: { deliveredEffectsAt: new Date() } });
    await prisma.order.updateMany({ where: { id: { in: created } }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
  });

  const subjects = () => sendMail.mock.calls.map((c) => String((c[0] as { subject: string }).subject));
  const alertState = async () => (await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert' } })).detail as Record<string, unknown>;

  it('email gửi đúng những lần webhook gửi: mở sự cố, đổi bộ sự cố, nhắc lại sau 6 giờ, báo đã ổn — không lần nào nhiều hơn', async () => {
    const same = () => expect(sendMail).toHaveBeenCalledTimes(fetchMock.mock.calls.length);

    queueFailures['notifications'] = 9;
    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    same();
    expect(subjects()[0]).toBe('[Tubu Tree · test] Sự cố vận hành: 1 vấn đề cần xử lý');
    const first = sendMail.mock.calls[0][0] as { to: string[]; from: unknown; text: string; html: string };
    expect(first.to).toEqual(['ops@tubutree.test', 'ceo@tubutree.test']);
    expect(first.from).toEqual({ name: 'Tubu Tree', address: 'alerts@tubutree.test' });
    expect(first.text).toContain('notifications');
    expect(first.html).toContain('notifications');
    expect(close).toHaveBeenCalledTimes(1);
    // Số người nhận in-app là tối đa MAX_ADMINS admin đầu bảng (DB dùng chung có thể nhiều admin): đếm theo một lần báo.
    const perSend = notify.mock.calls.length;
    expect(perSend).toBeGreaterThan(0);

    await expect(check(5)).resolves.toMatchObject({ sent: null });
    await expect(check(10)).resolves.toMatchObject({ sent: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    same();

    queueFailures['pancake-push'] = 9;
    await expect(check(15)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    same();
    expect(subjects()[1]).toContain('2 vấn đề');

    await expect(check(15 + 5 * 60)).resolves.toMatchObject({ sent: null });
    await expect(check(15 + 6 * 60)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    same();

    for (const k of Object.keys(queueFailures)) delete queueFailures[k];
    await expect(check(15 + 6 * 60 + 5)).resolves.toMatchObject({ sent: 'RECOVERED' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    same();
    expect(subjects()[3]).toBe('[Tubu Tree · test] Vận hành đã ổn trở lại');

    await expect(check(15 + 6 * 60 + 10)).resolves.toMatchObject({ sent: null });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    same();
    expect(notify).toHaveBeenCalledTimes(perSend * 4);
  });

  it('việc mới của hàng việc cho người trong giờ nhắc lại cũng làm cả hai kênh báo ngay', async () => {
    Object.assign(env, { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's' });
    await prisma.order.updateMany({ where: { pancakeAttentionAt: { not: null } }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
    const u = await createUser(prisma, {});
    const mk = async () => {
      const o = await createOrder(prisma, { userId: u.id, pancakeAttention: 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake', pancakeAttentionAt: new Date(0) });
      created.push(o.id);
      return o;
    };
    const a = await mk();
    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(String((sendMail.mock.calls[0][0] as { text: string }).text)).toContain(a.code);
    await expect(check(5)).resolves.toMatchObject({ sent: null });
    const b = await mk();
    await expect(check(10)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(String((sendMail.mock.calls[1][0] as { text: string }).text)).toContain(b.code);
  });

  it('chỉ đặt email (không webhook): vẫn nhận đúng các lần báo, không gọi webhook nào', async () => {
    env.OPS_ALERT_WEBHOOK_URL = '';
    queueFailures['notifications'] = 9;
    await check(0);
    await check(5);
    queueFailures['pancake-push'] = 9;
    await check(10);
    for (const k of Object.keys(queueFailures)) delete queueFailures[k];
    await check(15);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(subjects()).toEqual([
      '[Tubu Tree · test] Sự cố vận hành: 1 vấn đề cần xử lý',
      '[Tubu Tree · test] Sự cố vận hành: 2 vấn đề cần xử lý',
      '[Tubu Tree · test] Vận hành đã ổn trở lại',
    ]);
  });

  it('chỉ đặt webhook (không email): hành vi cũ nguyên vẹn, không tạo kết nối SMTP', async () => {
    for (const k of Object.keys(EMAIL_ENV)) delete env[k];
    queueFailures['notifications'] = 9;
    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(await alertState()).not.toHaveProperty('emailPending');
    const snap = await snapshotAt(0);
    expect(snap.alertChannels.email).toEqual({
      state: 'DISABLED',
      recipients: 0,
      issues: [],
      lastOkAt: null,
      lastErrorAt: null,
      lastError: null,
      lastErrorKind: null,
      lastErrorHint: null,
    });
  });

  it('SMTP lỗi: cron không đổ, webhook và in-app vẫn gửi đúng một lần, lượt sau chỉ gửi lại email; lỗi hiện ở ảnh chụp mà không lộ bí mật', async () => {
    queueFailures['notifications'] = 9;
    sendMail.mockRejectedValueOnce(Object.assign(new Error('Connection timeout to smtp.invalid for mailer-user hunter2-pass'), { code: 'ETIMEDOUT' }));

    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls.length).toBeGreaterThan(0);
    expect(await alertState()).toMatchObject({ emailPending: true });
    expect(await alertState()).not.toHaveProperty('webhookPending');

    const failed = (await snapshotAt(1)).alertChannels.email;
    expect(failed).toMatchObject({ state: 'READY', recipients: 2, lastOkAt: null, lastErrorAt: expect.any(String), lastErrorKind: 'TRANSIENT', lastErrorHint: null });
    expect(failed.lastError).toContain('ETIMEDOUT');
    expect(JSON.stringify(failed)).not.toContain('hunter2-pass');
    expect(JSON.stringify(failed)).not.toContain('mailer-user');

    notify.mockClear();
    await expect(check(5)).resolves.toMatchObject({ sent: null });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(await alertState()).not.toHaveProperty('emailPending');

    await check(10);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const ok = (await snapshotAt(11)).alertChannels.email;
    expect(ok.lastOkAt).not.toBeNull();
    expect(new Date(ok.lastOkAt!).getTime()).toBeGreaterThanOrEqual(new Date(ok.lastErrorAt!).getTime());
  });

  it('SMTP vẫn lỗi ở lượt thử lại: tiếp tục chờ, không tạo thêm email, không báo in-app lại', async () => {
    queueFailures['notifications'] = 9;
    sendMail.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await check(0);
    const perSend = notify.mock.calls.length;
    await check(5);
    await check(10);
    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(perSend);
    expect(await alertState()).toMatchObject({ emailPending: true });
  });

  describe('lỗi SMTP vĩnh viễn: không bão gửi lại', () => {
    const authError = () => Object.assign(new Error('Invalid login mailer-user hunter2-pass: 535 5.7.8 rejected'), { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 rejected' });
    const blocked = async () => (await alertState()) as { emailBlocked?: boolean; emailPending?: boolean; webhookPending?: boolean };

    it('sai mật khẩu (EAUTH 535): đúng MỘT lần thử qua nhiều lượt kiểm, webhook và in-app vẫn bình thường, màn hình chỉ rõ cách sửa mà không lộ bí mật', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
      for (const m of [5, 10, 15, 20, 25, 30, 60]) await expect(check(m)).resolves.toMatchObject({ sent: null });

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
      expect(await blocked()).not.toHaveProperty('emailPending');
      expect(await blocked()).not.toHaveProperty('webhookPending');
      expect(JSON.stringify(await alertState())).not.toContain('hunter2-pass');

      const ch = (await snapshotAt(61)).alertChannels.email;
      expect(ch).toMatchObject({ state: 'READY', lastErrorKind: 'AUTH', lastOkAt: null });
      expect(ch.lastErrorHint).toContain('Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS');
      expect(JSON.stringify(ch)).not.toContain('hunter2-pass');
      expect(JSON.stringify(ch)).not.toContain('mailer-user');
    });

    it('sự cố KHÁC xuất hiện (một quyết định ALERT mới) thì thử lại đúng một lần; vẫn lỗi thì vẫn chặn', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);

      queueFailures['pancake-push'] = 9;
      await expect(check(10)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await blocked()).toMatchObject({ emailBlocked: true });

      await check(15);
      await check(20);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    it('OPS-7: hàng việc tăng thêm (quyết định ALERT mới nhưng cùng bộ sự cố) và nhắc lại sau 6 giờ KHÔNG thử SMTP lại khi đang bị chặn; webhook và in-app vẫn báo; loại sự cố mới thì thử đúng một lần', async () => {
      Object.assign(env, { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's' });
      await prisma.order.updateMany({ where: { pancakeAttentionAt: { not: null } }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
      const u = await createUser(prisma, {});
      const mk = async () => {
        const o = await createOrder(prisma, { userId: u.id, status: 'CANCELLED', pancakeAttention: 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake', pancakeAttentionAt: new Date(0) });
        created.push(o.id);
        return o;
      };
      // Đơn chưa lên Pancake do spec khác để lại sẽ thành "kẹt" khi đồng hồ nhảy 6 giờ — một loại sự cố mới, không phải nhắc lại.
      await prisma.order.updateMany({ where: { pancakeOrderId: null, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'] } }, data: { status: 'CANCELLED' } });
      sendMail.mockRejectedValue(authError());
      await mk();
      await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(await blocked()).toMatchObject({ emailBlocked: true });

      for (const m of [5, 10, 15]) {
        await mk();
        await expect(check(m)).resolves.toMatchObject({ sent: 'ALERT' });
      }
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sendMail).toHaveBeenCalledTimes(1);

      await expect(check(15 + 6 * 60)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(await blocked()).toMatchObject({ emailBlocked: true });

      queueFailures['notifications'] = 9;
      await expect(check(15 + 6 * 60 + 5)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(sendMail).toHaveBeenCalledTimes(2);
      await mk();
      await expect(check(15 + 6 * 60 + 10)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
    });

    it('OPS-7: khi cấu hình đã sửa (nhả chặn) thì quyết định ALERT cùng bộ sự cố gửi được lại bình thường và gỡ chặn', async () => {
      Object.assign(env, { PANCAKE_API_KEY: 'k', PANCAKE_SHOP_ID: 's' });
      await prisma.order.updateMany({ where: { pancakeAttentionAt: { not: null } }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
      const u = await createUser(prisma, {});
      const mk = async () => {
        const o = await createOrder(prisma, { userId: u.id, status: 'CANCELLED', pancakeAttention: 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake', pancakeAttentionAt: new Date(0) });
        created.push(o.id);
      };
      sendMail.mockRejectedValue(authError());
      await mk();
      await check(0);
      await mk();
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);

      env.SMTP_PASS = 'new-app-password';
      sendMail.mockReset().mockResolvedValue({});
      await mk();
      await expect(check(10)).resolves.toMatchObject({ sent: 'ALERT' });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(await blocked()).not.toHaveProperty('emailBlocked');
    });

    it('báo đã ổn (RECOVERED) cũng là một quyết định mới: thử lại, và gửi được thì gỡ chặn', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValueOnce(authError());
      await check(0);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
      for (const k of Object.keys(queueFailures)) delete queueFailures[k];
      await expect(check(5)).resolves.toMatchObject({ sent: 'RECOVERED' });
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(subjects()[1]).toBe('[Tubu Tree · test] Vận hành đã ổn trở lại');
      expect(await blocked()).not.toHaveProperty('emailBlocked');
    });

    it('sửa cấu hình (đổi mật khẩu rồi chạy lại API): lượt kiểm kế tiếp thử lại đúng một lần, gửi được thì gỡ chặn và không gửi lại nữa', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);

      env.SMTP_PASS = 'new-app-password';
      sendMail.mockReset().mockResolvedValue({});
      await expect(check(10)).resolves.toMatchObject({ sent: null });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(String((sendMail.mock.calls[0][0] as { text: string }).text)).toContain('notifications');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await blocked()).not.toHaveProperty('emailBlocked');

      await check(15);
      await check(20);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const ch = (await snapshotAt(21)).alertChannels.email;
      expect(new Date(ch.lastOkAt!).getTime()).toBeGreaterThanOrEqual(new Date(ch.lastErrorAt!).getTime());
    });

    it('sửa cấu hình mà vẫn sai: thử lại một lần rồi lại chặn, không lặp mỗi lượt', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      env.SMTP_PASS = 'still-wrong';
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(2);
      await check(10);
      await check(15);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
    });

    it('admin gửi email thử thành công (không đổi cấu hình) → lượt kiểm kế tiếp gửi lại báo động đã bị chặn đúng một lần', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValueOnce(authError());
      await check(0);
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);

      sendMail.mockResolvedValue({});
      await expect(email.sendTest()).resolves.toMatchObject({ ok: true });
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(String((sendMail.mock.calls[1][0] as { subject: string }).subject)).toContain('Email thử');

      await expect(check(10)).resolves.toMatchObject({ sent: null });
      expect(sendMail).toHaveBeenCalledTimes(3);
      expect(String((sendMail.mock.calls[2][0] as { subject: string }).subject)).toContain('Sự cố vận hành');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await blocked()).not.toHaveProperty('emailBlocked');
      await check(15);
      expect(sendMail).toHaveBeenCalledTimes(3);
    });

    it('admin gửi email thử mà vẫn lỗi → không mở chặn, cron vẫn không gửi', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      const r = await email.sendTest();
      expect(r).toMatchObject({ ok: false, reason: 'SEND_FAILED', kind: 'AUTH' });
      expect(JSON.stringify(r)).not.toContain('hunter2-pass');
      await check(5);
      await check(10);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
    });

    it('R5-ADMIN-5: bị chặn (AUTH) → đổi cấu hình → email thử lỗi tạm thời → cron vẫn thử lại đúng một lần (rồi chặn lại nếu vẫn sai)', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);

      env.SMTP_HOST = 'smtp2.invalid';
      sendMail.mockReset().mockRejectedValue(Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' }));
      await expect(email.sendTest()).resolves.toMatchObject({ ok: false, reason: 'SEND_FAILED', kind: 'TRANSIENT' });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect((await snapshotAt(6)).alertChannels.email).toMatchObject({ lastErrorKind: 'TRANSIENT', lastErrorHint: null });

      sendMail.mockReset().mockRejectedValue(authError());
      await expect(check(10)).resolves.toMatchObject({ sent: null });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(String((sendMail.mock.calls[0][0] as { subject: string }).subject)).toContain('Sự cố vận hành');
      expect(await blocked()).toMatchObject({ emailBlocked: true });
      await check(15);
      await check(20);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('R5-ADMIN-5: email thử lỗi tạm thời chạy song song với lượt cron — dù thứ tự nào, lý do chặn vẫn là của lần lỗi vĩnh viễn', async () => {
      for (const order of ['test-first', 'cron-first'] as const) {
        await prisma.opsHealthState.deleteMany({});
        queueFailures['notifications'] = 9;
        sendMail.mockReset().mockRejectedValue(authError());
        await check(0);
        expect(await blocked()).toMatchObject({ emailBlocked: true });
        const before = sendMail.mock.calls.length;

        env.SMTP_HOST = `smtp-${order}.invalid`;
        sendMail.mockReset().mockImplementation(async (msg: { subject: string }) => {
          if (/Email thử/.test(msg.subject)) throw Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' });
          throw authError();
        });
        const runs = order === 'test-first' ? [email.sendTest(), check(5)] : [check(5), email.sendTest()];
        await Promise.all(runs);

        const subjectsNow = subjects();
        expect(subjectsNow.filter((x) => x.includes('Sự cố vận hành')).length).toBeLessThanOrEqual(1);
        expect(before).toBe(1);
        const block = await prisma.opsHealthState.findUniqueOrThrow({ where: { key: 'alert.email.block' } });
        expect((block.detail as { kind: string }).kind).toBe('AUTH');
        const calls = sendMail.mock.calls.length;
        await check(10);
        await check(15);
        expect(sendMail.mock.calls.length).toBe(calls);
        expect(await blocked()).toMatchObject({ emailBlocked: true });
      }
    });

    it('máy chủ từ chối hẳn (550) cũng chặn như sai mật khẩu; lỗi tạm thời (451) thì vẫn gửi lại mỗi lượt', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 User unknown"), { code: 'EENVELOPE', responseCode: 550 }));
      await check(0);
      await check(5);
      await check(10);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect((await snapshotAt(11)).alertChannels.email).toMatchObject({ lastErrorKind: 'PERMANENT' });
      expect((await snapshotAt(11)).alertChannels.email.lastErrorHint).toContain('OPS_ALERT_EMAIL_TO');

      await prisma.opsHealthState.deleteMany({});
      sendMail.mockReset().mockRejectedValue(Object.assign(new Error('451 4.3.0 try again'), { code: 'EMESSAGE', responseCode: 451 }));
      await check(20);
      await check(25);
      await check(30);
      expect(sendMail).toHaveBeenCalledTimes(3);
      expect(await blocked()).toMatchObject({ emailPending: true });
      expect(await blocked()).not.toHaveProperty('emailBlocked');
    });

    it('lỗi tạm thời rồi tới lượt thử lại gặp lỗi vĩnh viễn: bỏ chờ gửi lại, chuyển sang chặn', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).mockRejectedValue(authError());
      await check(0);
      expect(await blocked()).toMatchObject({ emailPending: true });
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(2);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
      expect(await blocked()).not.toHaveProperty('emailPending');
      await check(10);
      await check(15);
      expect(sendMail).toHaveBeenCalledTimes(2);
    });

    it('chặn không ảnh hưởng webhook: webhook lỗi vẫn tự gửi lại riêng, email vẫn đứng yên', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      await check(0);
      expect(await blocked()).toMatchObject({ emailBlocked: true, webhookPending: true });
      await check(5);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(await blocked()).toMatchObject({ emailBlocked: true });
      expect(await blocked()).not.toHaveProperty('webhookPending');
    });

    it('tắt email khi đang bị chặn: lượt kiểm sau nhả chặn, không gửi gì', async () => {
      queueFailures['notifications'] = 9;
      sendMail.mockRejectedValue(authError());
      await check(0);
      for (const k of Object.keys(EMAIL_ENV)) delete env[k];
      await check(5);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(await blocked()).not.toHaveProperty('emailBlocked');
    });
  });

  it('tạo kết nối SMTP ném lỗi ngay (không phải lời hứa bị từ chối) cũng không làm đổ cron', async () => {
    transportFactory = () => {
      throw new Error('socket exploded');
    };
    queueFailures['notifications'] = 9;
    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await alertState()).toMatchObject({ emailPending: true });
  });

  it('webhook lỗi, email được: lượt sau chỉ gửi lại webhook — email không bao giờ nhiều hơn webhook', async () => {
    queueFailures['notifications'] = 9;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await check(0);
    expect(await alertState()).toMatchObject({ webhookPending: true });
    expect(await alertState()).not.toHaveProperty('emailPending');
    await check(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('cấu hình email dở dang lúc chạy: không gửi, không treo chờ gửi lại, màn Sức khoẻ nêu khoá còn thiếu; webhook không bị ảnh hưởng', async () => {
    env.SMTP_HOST = '';
    queueFailures['notifications'] = 9;
    await expect(check(0)).resolves.toMatchObject({ sent: 'ALERT' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await alertState()).not.toHaveProperty('emailPending');
    const ch = (await snapshotAt(1)).alertChannels.email;
    expect(ch.state).toBe('MISCONFIGURED');
    expect(ch.issues.join(' ')).toContain('SMTP_HOST');
    expect(ch.lastError).toContain('SMTP_HOST');
  });

  it('không đưa email vào danh sách sự cố: kênh email hỏng không tự thành một báo động', async () => {
    env.SMTP_HOST = '';
    const snap = await snapshotAt(0);
    expect(snap.problems).toEqual([]);
  });
});
