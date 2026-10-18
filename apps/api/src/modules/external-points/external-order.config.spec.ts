import { BadRequestException } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_ORDER_SOURCE_MAP, EXTERNAL_CAPTURE_ENABLED_KEY, ORDER_SOURCE_MAP_KEY } from './external-order.config';

/** PUT /admin/config → AdminService.setConfig → SystemConfigService.set thật, DB chưa có dòng của khoá. */
function mk() {
  const tx = {
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const admin = new AdminService(prisma, new SystemConfigService(prisma), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { admin, tx };
}

describe('khoá cấu hình nạp đơn ngoài app ghi được từ admin', () => {
  it('có luật ghi nên hiện ở tab Cấu hình dù DB chưa có dòng', () => {
    expect(SystemConfigService.hasWriteRule(EXTERNAL_CAPTURE_ENABLED_KEY)).toBe(true);
    expect(SystemConfigService.hasWriteRule(ORDER_SOURCE_MAP_KEY)).toBe(true);
  });

  it('công tắc: true/false ghi được, chuỗi "false" bị từ chối', async () => {
    for (const v of [true, false]) {
      const { admin, tx } = mk();
      await expect(admin.setConfig('admin-1', EXTERNAL_CAPTURE_ENABLED_KEY, v)).resolves.toMatchObject({ ok: true, value: v });
      expect(tx.systemConfig.upsert).toHaveBeenCalled();
    }
    const { admin } = mk();
    await expect(admin.setConfig('admin-1', EXTERNAL_CAPTURE_ENABLED_KEY, 'false' as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bản đồ nguồn: giá trị mặc định và bản có chatSources ghi được', async () => {
    for (const v of [DEFAULT_ORDER_SOURCE_MAP, { marketplaceIds: { '-3': 'shopee' }, chatSources: ['-1|fanpage_a|'] }]) {
      const { admin, tx } = mk();
      await expect(admin.setConfig('admin-1', ORDER_SOURCE_MAP_KEY, v as never)).resolves.toMatchObject({ ok: true });
      expect(tx.systemConfig.upsert).toHaveBeenCalled();
    }
  });

  it.each([
    ['chuỗi', 'shopee'],
    ['mảng', []],
    ['thiếu chatSources', { marketplaceIds: { '-3': 'shopee' } }],
    ['khoá không phải số', { marketplaceIds: { shopee: 'shopee' }, chatSources: [] }],
  ])('bản đồ nguồn sai bị từ chối và không ghi: %s', async (_label, v) => {
    const { admin, tx } = mk();
    await expect(admin.setConfig('admin-1', ORDER_SOURCE_MAP_KEY, v as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
