import { configSeedUpsertArgs, type ConfigSeed } from './config-seed';

/**
 * Runbook deploy chạy lại seed mỗi lần deploy. Key admin sở hữu giá trị (kho lấy hàng Gomdon, công
 * tắc thu gom, hạn đổi/trả, hạn nhận thưởng đại lý…) KHÔNG được bị reset về mặc định.
 */
describe('configSeedUpsertArgs', () => {
  const row: ConfigSeed = { key: 'shipping.gomdon.config', value: { defaultWeightFallback: 500 }, category: 'shipping', description: 'd' };

  it('createOnly → update rỗng (giữ nguyên giá trị admin đã nhập), create đủ trường (không lọt cờ createOnly vào DB)', () => {
    const args = configSeedUpsertArgs({ ...row, createOnly: true });
    expect(args.where).toEqual({ key: 'shipping.gomdon.config' });
    expect(args.update).toEqual({});
    expect(args.create).toEqual({ key: 'shipping.gomdon.config', value: { defaultWeightFallback: 500 }, category: 'shipping', description: 'd' });
    expect(args.create).not.toHaveProperty('createOnly');
  });

  it('key thường → vẫn đồng bộ value/category/description theo seed như trước', () => {
    const args = configSeedUpsertArgs(row);
    expect(args.update).toEqual({ value: { defaultWeightFallback: 500 }, category: 'shipping', description: 'd' });
  });
});
