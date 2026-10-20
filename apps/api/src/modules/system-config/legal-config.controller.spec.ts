import { NotFoundException } from '@nestjs/common';
import { LegalConfigController, LEGAL_CONFIG_KEYS } from './legal-config.controller';
import type { SystemConfigService } from './system-config.service';

function makeConfig(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async (key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  } as unknown as SystemConfigService;
}

describe('LegalConfigController.get — nội dung điều khoản/chính sách cho web (D5-01)', () => {
  it('chỉ nhận bốn loại: điều khoản, bảo mật, đổi trả, vận chuyển', () => {
    expect(Object.keys(LEGAL_CONFIG_KEYS).sort()).toEqual(['bao-mat', 'dieu-khoan', 'doi-tra', 'van-chuyen']);
  });

  it('loại lạ → 404, không đọc khoá nào (không cho dò khoá cấu hình qua đường dẫn)', async () => {
    const config = makeConfig();
    await expect(new LegalConfigController(config).get('system.secret')).rejects.toBeInstanceOf(NotFoundException);
    await expect(new LegalConfigController(config).get('constructor')).rejects.toBeInstanceOf(NotFoundException);
    expect((config as unknown as { get: jest.Mock }).get).not.toHaveBeenCalled();
  });

  it('admin chưa nhập → content null để web dùng bản nháp mặc định', async () => {
    const out = await new LegalConfigController(makeConfig()).get('dieu-khoan');
    expect(out.loai).toBe('dieu-khoan');
    expect(out.content).toBeNull();
  });

  it('admin nhập → trả đúng nội dung của loại đó (khoá legal.<loại>)', async () => {
    const config = makeConfig({ 'legal.doi-tra': '# Đổi trả\n\nTrong 7 ngày.', 'legal.bao-mat': 'khác' });
    const out = await new LegalConfigController(config).get('doi-tra');
    expect(out.content).toBe('# Đổi trả\n\nTrong 7 ngày.');
    expect((config as unknown as { get: jest.Mock }).get).toHaveBeenCalledWith('legal.doi-tra', '');
  });

  it('để trống/toàn khoảng trắng hoặc sai kiểu → coi như chưa nhập', async () => {
    expect((await new LegalConfigController(makeConfig({ 'legal.bao-mat': '   \n ' })).get('bao-mat')).content).toBeNull();
    expect((await new LegalConfigController(makeConfig({ 'legal.bao-mat': { a: 1 } })).get('bao-mat')).content).toBeNull();
  });

  it('kèm các số mà bản nháp nhắc tới (hạn đổi trả, ngưỡng freeship) lấy từ đúng khoá hệ thống đang dùng', async () => {
    const config = makeConfig({ 'returns.window_days': 10, 'shipping.free_threshold': 300000 });
    const out = await new LegalConfigController(config).get('doi-tra');
    expect(out.vars).toEqual({ returnWindowDays: 10, freeshipThreshold: 300000 });
    const def = await new LegalConfigController(makeConfig()).get('doi-tra');
    expect(def.vars).toEqual({ returnWindowDays: 7, freeshipThreshold: 199000 });
  });

  it('ngưỡng freeship 0 là giá trị hợp lệ (mọi đơn miễn phí vận chuyển) và hạn đổi trả 0 cũng vậy: giữ nguyên số 0, không tự đổi về mặc định', async () => {
    const config = makeConfig({ 'shipping.free_threshold': 0, 'returns.window_days': 0 });
    const out = await new LegalConfigController(config).get('van-chuyen');
    expect(out.vars).toEqual({ returnWindowDays: 0, freeshipThreshold: 0 });
  });

  it('số cấu hình null/rỗng/đúng kiểu sai: về mặc định, không bị Number(null) = 0 đổi thành "miễn phí mọi đơn"', async () => {
    for (const bad of [null, '', '  ', true, [], {}]) {
      const config = makeConfig({ 'shipping.free_threshold': bad, 'returns.window_days': bad });
      const out = await new LegalConfigController(config).get('van-chuyen');
      expect(out.vars).toEqual({ returnWindowDays: 7, freeshipThreshold: 199000 });
    }
  });

  it('số cấu hình hỏng (chuỗi, âm, NaN) → rơi về mặc định thay vì in "NaN ngày" lên trang chính sách', async () => {
    const config = makeConfig({ 'returns.window_days': 'abc', 'shipping.free_threshold': -5 });
    const out = await new LegalConfigController(config).get('van-chuyen');
    expect(out.vars).toEqual({ returnWindowDays: 7, freeshipThreshold: 199000 });
  });
});
