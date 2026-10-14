import { OpsInboxService } from './ops-inbox.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MerchantFulfilmentService } from '../merchant/merchant-fulfilment.service';

describe('OpsInboxService — merchantProducts', () => {
  it('R3-MERCHANT-4: đếm cả sản phẩm đang bán có bản sửa chờ duyệt, cùng điều kiện với màn Duyệt SP đối tác', async () => {
    const productCount = jest.fn().mockResolvedValue(3);
    const zero = { count: jest.fn().mockResolvedValue(0) };
    const prisma = {
      product: { count: productCount },
      order: zero,
      orderCustomerRefund: zero,
      returnRequest: zero,
      dealerApplication: zero,
      dealerRewardClaim: zero,
      payout: zero,
      bottleReturn: zero,
      $queryRaw: jest.fn().mockResolvedValue([{ n: 0 }]),
    } as unknown as PrismaService;
    const merchant = { countOverdue: jest.fn().mockResolvedValue(0) } as unknown as MerchantFulfilmentService;

    const res = await new OpsInboxService(prisma, merchant).counts({ role: 'ADMIN' });

    expect(res.items.find((i) => i.key === 'merchantProducts')?.count).toBe(3);
    expect(productCount).toHaveBeenCalledWith({
      where: { OR: [{ approvalStatus: 'PENDING_REVIEW' }, { editDraft: { isNot: null } }] },
    });
  });
});
