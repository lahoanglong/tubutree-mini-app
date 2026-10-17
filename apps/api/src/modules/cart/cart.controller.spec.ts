import { CartController } from './cart.controller';
import type { CartService } from './cart.service';

describe('CartController — không lộ ID chủ gian hàng (R2-MERCHANT-14)', () => {
  it('mọi đường trả giỏ bỏ fulfiller.ownerUserId, giữ tên/kind/gian hàng để chia nhóm', async () => {
    const cart = {
      id: 'c1',
      subtotal: 90_000,
      items: [{ id: 'i1', fulfiller: { kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A', ownerUserId: 'u_ma' } }],
    };
    const svc = {
      getCart: jest.fn().mockResolvedValue(cart),
      addItem: jest.fn().mockResolvedValue(cart),
      updateItem: jest.fn().mockResolvedValue(cart),
      removeItem: jest.fn().mockResolvedValue(cart),
      applyCoupon: jest.fn().mockResolvedValue(cart),
      removeCoupon: jest.fn().mockResolvedValue(cart),
    } as unknown as CartService;
    const ctl = new CartController(svc);
    const all = await Promise.all([
      ctl.get('u1', {}),
      ctl.addItem('u1', { variationId: 'v1', quantity: 1 } as never, {}),
      ctl.updateItem('u1', 'i1', { quantity: 2 } as never, {}),
      ctl.removeItem('u1', 'i1', {}),
      ctl.applyCoupon('u1', { code: 'X' } as never, {}),
      ctl.removeCoupon('u1', {}),
    ]);
    for (const res of all) {
      expect(JSON.stringify(res)).not.toContain('u_ma');
      expect(res.items[0]!.fulfiller).toEqual({ kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A' });
    }
  });

  it('chuyển gian hàng đang ghi công (storefrontSlug) cho mọi đường trả giỏ để giỏ trừ combo như checkout', async () => {
    const cart = { items: [] };
    const svc = {
      getCart: jest.fn().mockResolvedValue(cart),
      addItem: jest.fn().mockResolvedValue(cart),
      updateItem: jest.fn().mockResolvedValue(cart),
      removeItem: jest.fn().mockResolvedValue(cart),
      applyCoupon: jest.fn().mockResolvedValue(cart),
      removeCoupon: jest.fn().mockResolvedValue(cart),
    };
    const ctl = new CartController(svc as unknown as CartService);
    const q = { storefrontSlug: 'shop-a' };
    await ctl.get('u1', q);
    await ctl.addItem('u1', { variationId: 'v1', quantity: 1 } as never, q);
    await ctl.updateItem('u1', 'i1', { quantity: 2 } as never, q);
    await ctl.removeItem('u1', 'i1', q);
    await ctl.applyCoupon('u1', { code: 'X' } as never, q);
    await ctl.removeCoupon('u1', q);
    expect(svc.getCart).toHaveBeenCalledWith('u1', 'shop-a');
    expect(svc.addItem).toHaveBeenCalledWith('u1', { variationId: 'v1', quantity: 1 }, 'shop-a');
    expect(svc.updateItem).toHaveBeenCalledWith('u1', 'i1', 2, 'shop-a');
    expect(svc.removeItem).toHaveBeenCalledWith('u1', 'i1', 'shop-a');
    expect(svc.applyCoupon).toHaveBeenCalledWith('u1', 'X', 'shop-a');
    expect(svc.removeCoupon).toHaveBeenCalledWith('u1', 'shop-a');
  });

  it('GET có itemIds: giá của phần chọn (getCartSelection); không có hoặc rỗng: cả giỏ', async () => {
    const cart = { items: [] };
    const svc = { getCart: jest.fn().mockResolvedValue(cart), getCartSelection: jest.fn().mockResolvedValue(cart) };
    const ctl = new CartController(svc as unknown as CartService);
    await ctl.get('u1', { storefrontSlug: 'shop-a', itemIds: ['i1', 'i2'] });
    expect(svc.getCartSelection).toHaveBeenCalledWith('u1', 'shop-a', ['i1', 'i2']);
    expect(svc.getCart).not.toHaveBeenCalled();
    await ctl.get('u1', { itemIds: [] });
    expect(svc.getCart).toHaveBeenCalledWith('u1', undefined);
  });
});

describe('CartController — áp mã ở giỏ cùng trần với nhận mã thẻ (D2-03)', () => {
  it('POST /cart/coupon giới hạn 10 lần/phút: gõ mã thẻ ở giỏ cũng nhận mã, không được là đường dò mã nhanh hơn /coupons/claim', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', CartController.prototype.applyCoupon)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', CartController.prototype.applyCoupon)).toBe(60_000);
  });
});
