import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PANCAKE_TOTAL_CHECK_KEY } from '../integrations/pancake/pancake.processor';
import type { PrismaService } from '../../prisma/prisma.service';

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
  const admin = new AdminService(
    prisma,
    new SystemConfigService(prisma),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { admin, tx };
}

describe('công tắc so tổng tiền Pancake ghi được từ admin (D1-03)', () => {
  it('khoá chưa có dòng trong DB: false và true đều ghi được', async () => {
    for (const v of [false, true]) {
      const { admin, tx } = mk();
      await expect(admin.setConfig('admin-1', PANCAKE_TOTAL_CHECK_KEY, v)).resolves.toMatchObject({ ok: true, key: PANCAKE_TOTAL_CHECK_KEY, value: v });
      expect(tx.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ key: PANCAKE_TOTAL_CHECK_KEY, value: v }) }));
    }
  });

  it('giá trị không phải boolean ("false", 0, null, object) bị 400, không ghi', async () => {
    for (const bad of ['false', 0, 1, null, {}] as const) {
      const { admin, tx } = mk();
      await expect(admin.setConfig('admin-1', PANCAKE_TOTAL_CHECK_KEY, bad as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.systemConfig.upsert).not.toHaveBeenCalled();
    }
  });
});
