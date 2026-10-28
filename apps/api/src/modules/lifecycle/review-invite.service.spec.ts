import { ReviewInviteService } from './review-invite.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { NotificationsService } from '../notifications/notifications.service';

type Item = { productName: string; productSlug: string | null; onSale: boolean };

/** Dựng service với prisma giả: truy vấn thô được nhận diện theo bảng mà câu SQL đọc. */
function setup(o: { items: Item[]; claimCount?: number; notify?: jest.Mock }) {
  const sql = (strings: TemplateStringsArray) => strings.join('?');
  const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    const text = sql(strings);
    if (text.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
    if (text.includes('FROM orders o')) return [{ id: 'o1', code: 'TT001', userId: 'u1' }];
    if (text.includes('FROM order_items')) return o.items;
    return [];
  });
  const updateMany = jest.fn().mockResolvedValue({ count: o.claimCount ?? 1 });
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $queryRaw: queryRaw }),
    order: { updateMany },
  } as unknown as PrismaService;
  const config = { get: async <T>(_k: string, fb: T) => fb } as unknown as SystemConfigService;
  const notify = o.notify ?? jest.fn().mockResolvedValue(undefined);
  const svc = new ReviewInviteService(prisma, config, { notify } as unknown as NotificationsService);
  return { svc, notify, updateMany };
}

describe('ReviewInviteService: dữ liệu tin REVIEW_REQUEST', () => {
  it('kèm order_id để nút "Viết đánh giá" mở thẳng form cho đúng đơn, cùng order_code và product_slug', async () => {
    const { svc, notify } = setup({ items: [{ productName: 'Sữa tắm IT', productSlug: 'sua-tam-it', onSale: true }] });
    await expect(svc.sendReviewInvites()).resolves.toEqual({ sent: 1, claimed: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('u1', 'REVIEW_REQUEST', {
      order_code: 'TT001',
      order_id: 'o1',
      product: 'Sữa tắm IT',
      product_slug: 'sua-tam-it',
    });
  });

  it('sản phẩm không có slug: vẫn có order_id, không có product_slug', async () => {
    const { svc, notify } = setup({ items: [{ productName: 'Hàng cũ', productSlug: null, onSale: true }] });
    await svc.sendReviewInvites();
    expect(notify.mock.calls[0]![2]).toEqual({ order_code: 'TT001', order_id: 'o1', product: 'Hàng cũ' });
  });

  it('nhiều sản phẩm chưa đánh giá: nêu sản phẩm đầu và số còn lại', async () => {
    const { svc, notify } = setup({
      items: [
        { productName: 'A', productSlug: 'a', onSale: true },
        { productName: 'B', productSlug: 'b', onSale: true },
      ],
    });
    await svc.sendReviewInvites();
    expect(notify.mock.calls[0]![2]).toMatchObject({ product: 'A và 1 sản phẩm khác', product_slug: 'a', order_id: 'o1' });
  });

  it('gửi lỗi: trả cờ reviewInvitedAt để lượt sau mời lại', async () => {
    const { svc, updateMany } = setup({ items: [{ productName: 'A', productSlug: 'a', onSale: true }], notify: jest.fn().mockRejectedValue(new Error('down')) });
    await expect(svc.sendReviewInvites()).resolves.toEqual({ sent: 0, claimed: 0 });
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'o1', reviewInvitedAt: expect.any(Date) }, data: { reviewInvitedAt: null } });
  });
});
