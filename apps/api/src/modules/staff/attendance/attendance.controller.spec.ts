import { BadRequestException } from '@nestjs/common';
import { AttendanceController, LOCATION_FROM_ZALO_MESSAGE } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { resolveZaloLocation } from './zalo-location';

jest.mock('./zalo-location', () => ({ resolveZaloLocation: jest.fn() }));
const resolveMock = resolveZaloLocation as jest.Mock;

function build(cfg: { officeIps?: string[]; enforceIp?: boolean }) {
  const system = {
    get: jest.fn(async (key: string, fb: unknown) =>
      key === 'attendance.office_ips' ? (cfg.officeIps ?? fb) : key === 'attendance.enforce_ip' ? (cfg.enforceIp ?? fb) : fb,
    ),
  } as unknown as SystemConfigService;
  const service = new AttendanceService({} as never, system);
  const heartbeat = jest.spyOn(service, 'heartbeat').mockResolvedValue({ ok: true } as never);
  const env = { get: jest.fn().mockReturnValue('secret') };
  const ctrl = new AttendanceController(service, env as never, {} as never);
  return { ctrl, heartbeat };
}
const req = { ip: '1.2.3.4' } as never;

describe('AttendanceController: toạ độ thô', () => {
  beforeEach(() => resolveMock.mockReset());

  it('không có IP văn phòng: lat/lng thô bị 400 kèm lời hướng dẫn, không gọi heartbeat', async () => {
    const { ctrl, heartbeat } = build({ officeIps: [] });
    const err = await ctrl.heartbeat('s1', { lat: 10.7, lng: 106.7 }, req).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(LOCATION_FROM_ZALO_MESSAGE);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('cờ enforce_ip tắt dù có IP: vẫn từ chối toạ độ thô', async () => {
    const { ctrl } = build({ officeIps: ['1.2.3.4'], enforceIp: false });
    await expect(ctrl.heartbeat('s1', { lat: 10.7, lng: 106.7 }, req)).rejects.toThrow(LOCATION_FROM_ZALO_MESSAGE);
  });

  it('token Zalo giải mã được: dùng toạ độ Zalo, không xét toạ độ thô', async () => {
    resolveMock.mockResolvedValue({ lat: 1, lng: 2 });
    const { ctrl, heartbeat } = build({ officeIps: [] });
    await ctrl.heartbeat('s1', { locationToken: 't', zaloAccessToken: 'a', lat: 10.7, lng: 106.7 } as never, req);
    expect(heartbeat).toHaveBeenCalledWith('s1', '1.2.3.4', { lat: 1, lng: 2 });
  });

  it('token giải mã hỏng kèm toạ độ thô, không có IP văn phòng: 400, không rơi về toạ độ thô', async () => {
    resolveMock.mockResolvedValue(null);
    const { ctrl } = build({ officeIps: [] });
    await expect(ctrl.heartbeat('s1', { locationToken: 't', zaloAccessToken: 'a', lat: 10.7, lng: 106.7 } as never, req)).rejects.toThrow(
      LOCATION_FROM_ZALO_MESSAGE,
    );
  });

  it('IP văn phòng đang bật: giữ hành vi cũ, nhận toạ độ thô', async () => {
    const { ctrl, heartbeat } = build({ officeIps: ['1.2.3.4'], enforceIp: true });
    await ctrl.heartbeat('s1', { lat: 10.7, lng: 106.7 }, req);
    expect(heartbeat).toHaveBeenCalledWith('s1', '1.2.3.4', { lat: 10.7, lng: 106.7 });
  });

  it('không có token lẫn toạ độ: giữ câu lỗi cũ', async () => {
    const { ctrl } = build({ officeIps: [] });
    await expect(ctrl.heartbeat('s1', {} as never, req)).rejects.toThrow('Không lấy được vị trí');
  });
});
