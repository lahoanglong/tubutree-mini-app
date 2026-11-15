import { WastePickupHooks } from './waste-pickup-hooks.service';

jest.mock('../core/waste-events', () => ({ writeWasteEvent: jest.fn().mockResolvedValue({ id: 'ev1' }) }));

const DELIVERED_AT = new Date('2026-11-20T03:00:00.000Z');

function setup(o: { orderStatus?: string; pickupThrows?: boolean; noGifts?: boolean } = {}) {
  const prisma = {
    order: {
      findUnique: o.pickupThrows
        ? jest.fn().mockRejectedValue(new Error('db down'))
        : jest.fn().mockResolvedValue({ status: o.orderStatus ?? 'DELIVERED', deliveredAt: DELIVERED_AT }),
    },
    // Đơn không có yêu cầu thu rác: nhánh thu kèm trả NO_REQUEST, quà vẫn phải được xử lý.
    wasteRequest: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const gifts = { onOrderDelivered: jest.fn().mockResolvedValue(1), onOrderReleased: jest.fn().mockResolvedValue(1) };
  const hooks = new WastePickupHooks(prisma as never, { snapshot: jest.fn() } as never, {} as never, o.noGifts ? undefined : (gifts as never));
  return { hooks, gifts };
}

describe('WastePickupHooks: quà hiện vật gắn đơn', () => {
  it('đơn DELIVERED: hoàn tất quà gắn đơn đó dù đơn không có yêu cầu thu rác', async () => {
    const h = setup();
    await h.hooks.onOrderDelivered('o1');
    expect(h.gifts.onOrderDelivered).toHaveBeenCalledWith('o1');
    expect(h.gifts.onOrderReleased).not.toHaveBeenCalled();
  });

  it('đơn CANCELLED: nhả quà khỏi đơn, quà vẫn READY', async () => {
    const h = setup({ orderStatus: 'CANCELLED' });
    await h.hooks.onOrderCancelled('o1');
    expect(h.gifts.onOrderReleased).toHaveBeenCalledWith('o1');
    expect(h.gifts.onOrderDelivered).not.toHaveBeenCalled();
  });

  it('nhánh thu rác ném lỗi thì quà vẫn được xử lý, và hook không ném lỗi ra việc đổi trạng thái đơn', async () => {
    const delivered = setup({ pickupThrows: true });
    await expect(delivered.hooks.onOrderDelivered('o1')).resolves.toBeUndefined();
    expect(delivered.gifts.onOrderDelivered).toHaveBeenCalledWith('o1');

    const cancelled = setup({ pickupThrows: true });
    await expect(cancelled.hooks.onOrderCancelled('o1')).resolves.toBeUndefined();
    expect(cancelled.gifts.onOrderReleased).toHaveBeenCalledWith('o1');
  });

  it('hook quà lỗi chỉ ghi log, không ném ra ngoài', async () => {
    const h = setup();
    h.gifts.onOrderDelivered.mockRejectedValue(new Error('deadlock'));
    h.gifts.onOrderReleased.mockRejectedValue(new Error('deadlock'));
    await expect(h.hooks.onOrderDelivered('o1')).resolves.toBeUndefined();
    await expect(h.hooks.onOrderCancelled('o1')).resolves.toBeUndefined();
  });

  it('không có dịch vụ quà (module cũ, spec cũ): hook thu rác chạy bình thường', async () => {
    const h = setup({ noGifts: true });
    await expect(h.hooks.onOrderDelivered('o1')).resolves.toBeUndefined();
    await expect(h.hooks.onOrderCancelled('o1')).resolves.toBeUndefined();
  });
});
