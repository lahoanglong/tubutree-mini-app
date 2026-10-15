import { BadGatewayException, BadRequestException, Logger } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { STAFF_PERMISSIONS_KEY } from '../../common/staff-permissions';
import { OpsController } from './ops.controller';
import type { TestEmailResult } from './ops-email.service';

function controller(result: TestEmailResult) {
  const email = { sendTest: jest.fn().mockResolvedValue(result) };
  return { ctrl: new OpsController({} as never, email as never, {} as never, {} as never), email };
}

describe('OpsController — email thử báo động', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('gửi được → báo số địa chỉ nhận', async () => {
    const { ctrl, email } = controller({ ok: true, recipients: 2 });
    await expect(ctrl.testAlertEmail('admin-1')).resolves.toEqual({ ok: true, message: expect.stringContaining('2 địa chỉ') });
    expect(email.sendTest).toHaveBeenCalledTimes(1);
  });

  it.each<[string, TestEmailResult]>([
    ['chưa cấu hình', { ok: false, reason: 'DISABLED', error: 'Chưa cấu hình email báo động: đặt OPS_ALERT_EMAIL_TO' }],
    ['cấu hình dở dang', { ok: false, reason: 'MISCONFIGURED', error: 'SMTP_HOST còn trống' }],
  ])('%s → 400 kèm lý do', async (_n, result) => {
    const { ctrl } = controller(result);
    const err = await ctrl.testAlertEmail('admin-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(result.ok ? '' : result.error);
  });

  it('SMTP từ chối → 502 kèm lý do đã che bí mật', async () => {
    const { ctrl } = controller({ ok: false, reason: 'SEND_FAILED', error: 'EAUTH: 535 5.7.8 rejected' });
    const err = await ctrl.testAlertEmail('admin-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).message).toContain('EAUTH');
  });

  it('chỉ ADMIN dùng được: cả controller là @Roles("ADMIN"), hành động không mở cho STAFF', () => {
    expect(Reflect.getMetadata(ROLES_KEY, OpsController)).toEqual(['ADMIN']);
    const handler = OpsController.prototype.testAlertEmail;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, handler)).toBeUndefined();
  });
});
