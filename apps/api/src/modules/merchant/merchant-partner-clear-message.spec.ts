import { ConflictException } from '@nestjs/common';
import { MerchantFulfilmentService, type SettlementConfig } from './merchant-fulfilment.service';
import type { PrismaService } from '../../prisma/prisma.service';

function build() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([{ type: 'CTV', isPartner: true }]),
    storefront: { findMany: jest.fn().mockResolvedValue([{ id: 'sf-1' }]), update: jest.fn() },
    userAdminEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
  };
  const svc = new MerchantFulfilmentService({} as PrismaService, {} as never);
  jest.spyOn(svc as never, 'partnerBlockers' as never).mockResolvedValue(['1 đơn tự giao chưa xong'] as never);
  const run = (fromRole: string, spareAdminToggled: boolean) =>
    svc.clearPartnerOnRoleLoss(tx as never, 'u1', 'admin-1', {} as SettlementConfig, fromRole, { spareAdminToggled }).catch((e: unknown) => e);
  return { run, tx };
}

describe('clearPartnerOnRoleLoss — lời 409 theo vai trò trước đó', () => {
  it('DEALER bị thu hồi: lời thu hồi vai trò đại lý', async () => {
    const err = (await build().run('DEALER', false)) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('Chưa thể thu hồi vai trò đại lý vì gian hàng đối tác còn vướng: 1 đơn tự giao chưa xong');
  });

  it.each(['STAFF', 'ADMIN'])('%s hạ xuống: lời hạ vai trò kèm gợi ý đặt DEALER', async (from) => {
    const err = (await build().run(from, false)) as ConflictException;
    expect(err.message).toContain('Chưa thể hạ vai trò vì gian hàng đối tác của người này còn vướng: 1 đơn tự giao chưa xong');
    expect(err.message).toContain('đặt vai trò DEALER');
  });

  it.each(['CUSTOMER', 'AFFILIATE'])('%s được đặt lại vai trò: lời về cờ do vai trò trước đây, không nói hạ vai trò, không gợi ý DEALER', async (from) => {
    const err = (await build().run(from, true)) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('Cờ đối tác của gian hàng còn vướng do vai trò trước đây: 1 đơn tự giao chưa xong');
    expect(err.message).not.toContain('hạ vai trò');
    expect(err.message).not.toContain('DEALER');
  });
});
