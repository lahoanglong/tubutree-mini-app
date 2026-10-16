import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { CouponMinOrderError, CouponsService } from '../coupons/coupons.service';
import { COUPON_PRODUCT_FLASH_REASON } from '../coupons/coupon-notice';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

const coupons = {} as unknown as CouponsService;
const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const flash = { resolveEffective: jest.fn().mockResolvedValue(new Map()) } as unknown as FlashSaleService;
// Stub dùng chung cho các test KHÔNG assert analytics (guard tồn kho/coupon/...) — không test nào
// trong nhóm này đi tới nhánh addItem() thành công (đều throw sớm), nên record()/recordBestEffort()
// không bao giờ được gọi ở đây.
const analytics = { record: jest.fn(), recordBestEffort: jest.fn() } as unknown as AnalyticsEventsService;

describe('CartService guard tồn kho', () => {
  it('addItem: chặn sản phẩm không khả dụng (inactive/không tồn tại)', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('không khả dụng');
  });

  // P0 A2-03=A5-06=A6-04 (phần còn sót ngoài catalog): SP PENDING_REVIEW/REJECTED không còn
  // tìm thấy qua catalog/search/related/for-you (đã sửa ở CatalogService), nhưng ai đã có sẵn
  // variationId (link cũ, đã lưu trước khi bị từ chối...) vẫn thêm được vào giỏ nếu chỉ kiểm
  // variation.isActive — phải kiểm cả product.approvalStatus.
  it('addItem: chặn SP đối tác CHƯA DUYỆT/BỊ TỪ CHỐI dù đã có sẵn variationId (approvalStatus)', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { isActive: true, approvalStatus: 'PENDING_REVIEW' } }),
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('không khả dụng');
    const rejected = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { isActive: true, approvalStatus: 'REJECTED' } }),
      },
    } as unknown as PrismaService;
    await expect(new CartService(rejected, coupons, config, flash, analytics).addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow(
      'không khả dụng',
    );
  });

  it('addItem: chặn SP cha đã ngừng bán (Product.isActive=false) dù variation còn active (C-007)', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { isActive: false, approvalStatus: 'APPROVED' } }),
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('không khả dụng');
  });

  describe('addItem: hàng của gian hàng chưa nhận đơn bị chặn ngay lúc thêm vào giỏ (R3-MERCHANT-3)', () => {
    const merchantVariation = (store: Record<string, unknown>) => ({
      id: 'v1',
      isActive: true,
      stock: 3,
      product: {
        isActive: true,
        approvalStatus: 'APPROVED',
        name: 'Xà phòng thủ công',
        fulfilment: 'MERCHANT',
        storefrontId: 'sf-a',
        storefront: { title: 'Shop A', type: 'MERCHANT', ordersPausedAt: null, owner: { role: 'DEALER', isBlocked: false }, ...store },
      },
    });
    const build = (variation: unknown) => {
      const upsert = jest.fn();
      const prisma = {
        cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
        variation: { findUnique: jest.fn().mockResolvedValue(variation) },
        cartItem: { findUnique: jest.fn().mockResolvedValue(null), upsert },
        $transaction: jest.fn(),
      } as unknown as PrismaService;
      return { svc: new CartService(prisma, coupons, config, flash, analytics), upsert, prisma };
    };

    it('gian hàng tạm nghỉ → 400 nói tạm nghỉ, giỏ không thêm gì', async () => {
      const { svc, prisma } = build(merchantVariation({ ordersPausedAt: new Date() }));
      const err = await svc.addItem('u1', { variationId: 'v1', quantity: 1 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toContain('Shop A đang tạm nghỉ');
      expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['chủ gian hàng bị khoá', { owner: { role: 'DEALER', isBlocked: true } }],
      ['chủ gian hàng không còn quyền đối tác', { owner: { role: 'CUSTOMER', isBlocked: false } }],
    ])('%s → 400 nói đã ngừng bán', async (_label, store) => {
      const { svc } = build(merchantVariation(store));
      await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('Shop A đã ngừng bán');
    });

    it('hàng Tubu giao không bị ảnh hưởng bởi trạng thái gian hàng', async () => {
      const tubu = { id: 'v1', isActive: true, stock: 3, product: { isActive: true, approvalStatus: 'APPROVED', name: 'X', fulfilment: 'TUBU', storefrontId: null, storefront: null } };
      const { svc } = build(tubu);
      await expect(svc.addItem('u1', { variationId: 'v1', quantity: 5 })).rejects.toThrow('Chỉ còn 3 sản phẩm');
    });
  });

  it('getCart: dòng SP ngừng bán/chưa duyệt bị tách ra unavailableItems, không tính vào items/subtotal (C-007)', async () => {
    const line = (id: string, product: { isActive: boolean; approvalStatus: string }, isActive = true) => ({
      id: `ci-${id}`,
      variationId: id,
      quantity: 1,
      variation: {
        isActive,
        productId: `p-${id}`,
        salePrice: null,
        retailPrice: 10000,
        stock: 5,
        name: id,
        product: { name: `SP ${id}`, slug: id, thumbnail: null, ...product },
      },
    });
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: null,
          items: [
            line('ok', { isActive: true, approvalStatus: 'APPROVED' }),
            line('off', { isActive: false, approvalStatus: 'APPROVED' }),
            line('rej', { isActive: true, approvalStatus: 'REJECTED' }),
            line('pend', { isActive: true, approvalStatus: 'PENDING_REVIEW' }),
            line('vOff', { isActive: true, approvalStatus: 'APPROVED' }, false),
          ],
        }),
      },
    } as unknown as PrismaService;
    const resolveEffective = jest.fn().mockResolvedValue(new Map());
    const svc = new CartService(prisma, coupons, config, { resolveEffective } as unknown as FlashSaleService, analytics);
    const c = await svc.getCart('u1');
    expect(c.items.map((l) => l.variationId)).toEqual(['ok']);
    expect(c.subtotal).toBe(10000);
    expect(c.itemCount).toBe(1);
    expect(c.unavailableItems.map((l) => l.variationId)).toEqual(['off', 'rej', 'pend', 'vOff']);
    expect(c.unavailableItems[0]).toEqual(
      expect.objectContaining({ id: 'ci-off', productName: 'SP off', quantity: 1 }),
    );
    // Giá giờ vàng chỉ tra cho dòng còn bán.
    expect(resolveEffective).toHaveBeenCalledWith(['ok'], expect.any(Date), 'u1');
  });

  it('getCart: ngưỡng freeship theo hạng của khách, cùng ngưỡng checkout dùng (R2-ENGAGE-16)', async () => {
    const tierConfig = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        (k === 'shipping.tier_freeship_overrides' ? { LOC_BIEC: 99000 } : k === 'shipping.free_threshold' ? 200000 : fb) as T,
    } as unknown as SystemConfigService;
    const cartRow = (tierId: string | null) => ({ id: 'c1', couponCode: null, items: [], user: { tierId } });
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }), findUniqueOrThrow: jest.fn().mockResolvedValue(cartRow('LOC_BIEC')) },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, tierConfig, flash, analytics);
    expect((await svc.getCart('u1')).freeshipThreshold).toBe(99000);
    (prisma.cart.findUniqueOrThrow as jest.Mock).mockResolvedValue(cartRow(null));
    expect((await svc.getCart('u1')).freeshipThreshold).toBe(200000);
  });

  it('addItem: chặn khi tổng số lượng vượt tồn kho', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { isActive: true, approvalStatus: 'APPROVED' } }),
      },
      cartItem: { findUnique: jest.fn().mockResolvedValue({ quantity: 2 }), upsert: jest.fn() },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    // đã có 2, thêm 2 = 4 > 3
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 2 })).rejects.toThrow('Chỉ còn 3');
    expect((prisma.cartItem!.upsert as jest.Mock)).not.toHaveBeenCalled();
  });

  // Task 11: cartItem.upsert + ghi add_to_cart giờ nằm TRONG một $transaction riêng (không đụng
  // đến ensureCart/variation lookup/stock-check ở ngoài, và addItem() vẫn phải trả về
  // this.getCart(userId) y hệt trước — KHÔNG được trả thẳng kết quả upsert).
  it('addItem: thành công → cartItem.upsert chạy TRONG transaction + ghi add_to_cart ATOMIC (record(tx,...), không phải recordBestEffort)', async () => {
    const analyticsSpy = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn(),
    } as unknown as AnalyticsEventsService;
    const txUpsert = jest.fn().mockResolvedValue({});
    // tx là object HOÀN TOÀN RIÊNG BIỆT với `prisma` top-level bên dưới — chứng minh addItem()
    // thật sự dùng transaction client (không lén gọi thẳng this.prisma.cartItem.upsert).
    const tx = { cartItem: { upsert: txUpsert } };
    const transactionSpy = jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1', items: [], couponCode: null }),
      },
      variation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'v1', isActive: true, stock: 10, product: { isActive: true, approvalStatus: 'APPROVED' } }),
      },
      cartItem: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      $transaction: transactionSpy,
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analyticsSpy);

    const result = await svc.addItem('u1', { variationId: 'v1', quantity: 2, addSource: 'buy_now' });

    expect(tx).not.toBe(prisma); // tx độc lập, không phải cùng reference với mock prisma top-level
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(txUpsert).toHaveBeenCalledWith({
      where: { cartId_variationId: { cartId: 'c1', variationId: 'v1' } },
      update: { quantity: { increment: 2 } },
      create: { cartId: 'c1', variationId: 'v1', quantity: 2 },
    });
    // upsert đi qua tx, KHÔNG gọi thẳng this.prisma.cartItem.upsert (ngoài transaction).
    expect((prisma.cartItem!.upsert as jest.Mock)).not.toHaveBeenCalled();
    expect(analyticsSpy.record).toHaveBeenCalledTimes(1);
    expect(analyticsSpy.record).toHaveBeenCalledWith(tx, {
      eventName: 'add_to_cart',
      userId: 'u1',
      platform: 'miniapp',
      props: { variationId: 'v1', quantity: 2, addSource: 'buy_now' },
    });
    expect(analyticsSpy.recordBestEffort).not.toHaveBeenCalled();
    // Hợp đồng API không đổi: addItem() vẫn trả về full cart view của getCart(), KHÔNG PHẢI kết
    // quả thô của upsert.
    expect(result).toEqual({
      items: [],
      couponCode: null,
      couponNotice: null,
      couponRemoved: null,
      subtotal: 0,
      discount: 0,
      freeship: false,
      freeshipThreshold: 200000,
      itemCount: 0,
      unavailableItems: [],
    });
  });

  it('addItem: không truyền addSource → mặc định "pdp" trong props sự kiện add_to_cart', async () => {
    const analyticsSpy = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn(),
    } as unknown as AnalyticsEventsService;
    const tx = { cartItem: { upsert: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1', items: [], couponCode: null }),
      },
      variation: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'v1', isActive: true, stock: 10, product: { isActive: true, approvalStatus: 'APPROVED' } }),
      },
      cartItem: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analyticsSpy);

    await svc.addItem('u1', { variationId: 'v1', quantity: 1 });

    expect(analyticsSpy.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ props: expect.objectContaining({ addSource: 'pdp' }) }),
    );
  });

  it('updateItem: chặn set quantity vượt tồn kho', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'it1', cartId: 'c1', variation: { stock: 5 } }),
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.updateItem('u1', 'it1', 10)).rejects.toThrow('Chỉ còn 5');
    expect((prisma.cartItem!.update as jest.Mock)).not.toHaveBeenCalled();
  });

  it('updateItem: chặn thao tác mục giỏ của cart khác', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      cartItem: { findUnique: jest.fn().mockResolvedValue({ id: 'it1', cartId: 'OTHER', variation: { stock: 5 } }) },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.updateItem('u1', 'it1', 1)).rejects.toThrow('Không tìm thấy');
  });

  // FE QuantitySelector cho phép giảm tới 0 → onQty(0) → BE chuyển thành DELETE.
  // Trước đây path này không có test, dễ hỏng âm thầm nếu ai đó đổi if-quantity===0.
  it('updateItem: quantity=0 → xoá CartItem (path delete)', async () => {
    const del = jest.fn().mockResolvedValue({});
    const upd = jest.fn();
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1', items: [], couponCode: null }),
      },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue({ id: 'it1', cartId: 'c1', variation: { stock: 5 } }),
        delete: del,
        update: upd,
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await svc.updateItem('u1', 'it1', 0);
    expect(del).toHaveBeenCalledWith({ where: { id: 'it1' } });
    expect(upd).not.toHaveBeenCalled();
  });

  it('line flash dùng flashPrice + coupon base loại flash item', async () => {
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 0, freeship: false });
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: 'SALE',
          items: [
            {
              id: 'ci1',
              variationId: 'v1',
              quantity: 1,
              variation: {
                isActive: true, productId: 'p1',
                salePrice: null,
                retailPrice: 100000,
                stock: 5,
                name: 'A',
                product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' },
              },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 2,
              variation: {
                isActive: true, productId: 'p2',
                salePrice: null,
                retailPrice: 50000,
                stock: 5,
                name: 'B',
                product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' },
              },
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const flashSvc = {
      resolveEffective: jest
        .fn()
        .mockResolvedValue(new Map([['v1', { flashPrice: 80000, itemId: 'fi1', endAt: new Date(), soldCount: 3, quota: 10 }]])),
    } as any;
    const couponsSvc = { validateAndCompute } as any;
    const cart = await new CartService(prisma, couponsSvc, config, flashSvc, analytics).getCart('u1');
    const l1 = cart.items.find((l: any) => l.variationId === 'v1')!;
    const l2 = cart.items.find((l: any) => l.variationId === 'v2')!;
    expect(l1.unitPrice).toBe(80000);
    expect(l1.isFlash).toBe(true);
    expect(l1.flashSaleItemId).toBe('fi1');
    expect(l2.isFlash).toBe(false);
    // coupon base = tổng line KHÔNG flash = v2 (2×50000)=100000, KHÔNG gồm v1
    expect(validateAndCompute).toHaveBeenCalledWith('SALE', 'u1', 100000, [{ productId: 'p2', total: 100000 }]);
  });

  it('flash line: flashPrice > standing → charge theo standing (không cao hơn giá bán); soldPct quota=0 → 0', async () => {
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: null,
          items: [
            {
              id: 'ci1',
              variationId: 'v1',
              quantity: 1,
              variation: {
                isActive: true, productId: 'p1',
                salePrice: null,
                retailPrice: 60000,
                stock: 5,
                name: 'A',
                product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' },
              },
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const flashSvc = {
      resolveEffective: jest
        .fn()
        .mockResolvedValue(new Map([['v1', { flashPrice: 80000, itemId: 'fi1', endAt: new Date(), soldCount: 0, quota: 0 }]])),
    } as any;
    const cart = await new CartService(prisma, coupons, config, flashSvc, analytics).getCart('u1');
    const l1 = cart.items[0]!;
    expect(l1.unitPrice).toBe(60000); // min(80000, 60000) → không charge cao hơn standing
    expect(l1.total).toBe(60000);
    expect(l1.isFlash).toBe(true); // vẫn là dòng flash (vẫn tiêu quota)
    expect(l1.flashSaleItemId).toBe('fi1');
    expect(l1.soldPct).toBe(0); // quota=0 → tránh chia 0
  });

  describe('ENGAGE-4: số lượng vượt suất giờ vàng còn lại của khách → cả dòng tính giá thường, kèm lý do', () => {
    const cartWith = (quantity: number, flash: Record<string, unknown>) => {
      const prisma = {
        cart: {
          upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'c1',
            couponCode: null,
            items: [
              {
                id: 'ci1',
                variationId: 'v1',
                quantity,
                variation: { isActive: true, productId: 'p1', salePrice: null, retailPrice: 260000, stock: 50, name: 'A', product: { name: 'Mật ong', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
              },
            ],
          }),
        },
      } as any;
      const flashSvc = {
        resolveEffective: jest.fn().mockResolvedValue(
          new Map([['v1', { flashPrice: 200000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 2, ...flash }]]),
        ),
      } as any;
      return new CartService(prisma, coupons, config, flashSvc, analytics).getCart('u1');
    };

    it('trong suất (qty 1, còn 1) → giá giờ vàng, không có lý do', async () => {
      const l = (await cartWith(1, { allowance: 1, perUserLeft: 1, quotaLeft: 1 })).items[0]!;
      expect(l).toMatchObject({ unitPrice: 200000, isFlash: true, flashSaleItemId: 'fi1', flashLimitNotice: null });
    });

    it('khách đã mua hết giới hạn/khách → giá thường, không tiêu suất khi đặt', async () => {
      const c = await cartWith(1, { allowance: 0, perUserLeft: 0, quotaLeft: 1 });
      expect(c.items[0]).toMatchObject({
        unitPrice: 260000,
        total: 260000,
        isFlash: false,
        flashSaleItemId: null,
        flashLimitNotice: 'Bạn đã dùng hết suất giờ vàng của sản phẩm này, sản phẩm đang tính giá thường.',
      });
      expect(c.subtotal).toBe(260000);
    });

    it('qty 3 > suất còn 1 (hết suất chung) → giá thường, báo còn bao nhiêu suất', async () => {
      const l = (await cartWith(3, { allowance: 1, perUserLeft: 5, quotaLeft: 1 })).items[0]!;
      expect(l).toMatchObject({ unitPrice: 260000, isFlash: false, flashSaleItemId: null });
      expect(l.flashLimitNotice).toBe('Chỉ còn 1 suất giờ vàng. Giảm số lượng còn 1 để được giá giờ vàng, hoặc mua 3 sản phẩm với giá thường.');
    });

    it('qty 2 > giới hạn/khách còn 1 → giá thường, báo giới hạn mỗi khách', async () => {
      const l = (await cartWith(2, { allowance: 1, perUserLeft: 1, quotaLeft: 5 })).items[0]!;
      expect(l.isFlash).toBe(false);
      expect(l.flashLimitNotice).toBe('Giá giờ vàng chỉ áp dụng tối đa 1 sản phẩm cho bạn. Giảm số lượng còn 1 để được giá giờ vàng, hoặc mua 2 sản phẩm với giá thường.');
    });
  });

  it('applyCoupon: validate trên base KHÔNG flash (không phải subtotal đầy đủ)', async () => {
    const validateAndCompute = jest.fn().mockResolvedValue({ discount: 0, freeship: false });
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: null,
          items: [
            {
              id: 'ci1',
              variationId: 'v1',
              quantity: 1,
              variation: { isActive: true, productId: 'p1', salePrice: null, retailPrice: 100000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 2,
              variation: { isActive: true, productId: 'p2', salePrice: null, retailPrice: 50000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const flashSvc = {
      resolveEffective: jest
        .fn()
        .mockResolvedValue(new Map([['v1', { flashPrice: 80000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])),
    } as any;
    const couponsSvc = { validateAndCompute } as any;
    await new CartService(prisma, couponsSvc, config, flashSvc, analytics).applyCoupon('u1', ' save ');
    // subtotal đầy đủ = v1(80000)+v2(100000)=180000; base KHÔNG flash = v2 = 100000
    expect(validateAndCompute).toHaveBeenCalledWith('SAVE', 'u1', 100000, [{ productId: 'p2', total: 100000 }]);
    expect(validateAndCompute).not.toHaveBeenCalledWith('SAVE', 'u1', 180000, expect.anything());
    // Lưu mã đã chuẩn hoá (ADMINOPS-7) — giỏ/đơn luôn mang đúng Coupon.code.
    expect(prisma.cart.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { couponCode: 'SAVE' } });
  });

  describe('R2-BUYERMINI-3: nói rõ hàng giờ vàng bị loại khỏi điều kiện/giảm giá của mã', () => {
    const flashCart = (couponCode: string | null) => ({
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode,
          items: [
            { id: 'ci1', variationId: 'v1', quantity: 2, variation: { isActive: true, productId: 'p1', salePrice: null, retailPrice: 90000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } } },
            { id: 'ci2', variationId: 'v2', quantity: 1, variation: { isActive: true, productId: 'p2', salePrice: null, retailPrice: 165000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } } },
          ],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    }) as any;
    const flashSvc = {
      resolveEffective: jest.fn().mockResolvedValue(new Map([['v1', { flashPrice: 69000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])),
    } as any;

    it('applyCoupon bị từ chối vì đơn tối thiểu mà tính cả hàng giờ vàng thì đủ: lỗi nói hàng giờ vàng không được tính và phần được tính là bao nhiêu', async () => {
      const validateAndCompute = jest
        .fn()
        .mockRejectedValueOnce(new CouponMinOrderError(250000, 165000))
        .mockResolvedValueOnce({ discount: 25000, freeship: false });
      const prisma = flashCart(null);
      await expect(new CartService(prisma, { validateAndCompute } as any, config, flashSvc, analytics).applyCoupon('u1', 'XANH10')).rejects.toThrow(
        'Đơn tối thiểu 250.000đ để dùng mã này. Hàng giờ vàng không được tính vào điều kiện của mã, phần được tính là 165.000đ.',
      );
      expect(validateAndCompute).toHaveBeenLastCalledWith('XANH10', 'u1', 303000, [
        { productId: 'p1', total: 138000 },
        { productId: 'p2', total: 165000 },
      ]);
      expect(prisma.cart.update).not.toHaveBeenCalled();
    });

    it('applyCoupon: mã không tồn tại / hết hạn / hết lượt khi giỏ có hàng giờ vàng → giữ nguyên lỗi, không nhắc giờ vàng', async () => {
      for (const reason of ['Mã giảm giá không tồn tại.', 'Mã giảm giá đã hết hạn hoặc chưa hiệu lực.', 'Bạn đã dùng hết lượt cho mã này.']) {
        const couponsSvc = { validateAndCompute: jest.fn().mockRejectedValue(new BadRequestException(reason)) } as any;
        const err = await new CartService(flashCart(null), couponsSvc, config, flashSvc, analytics).applyCoupon('u1', 'XANH10').catch((e: Error) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe(reason);
      }
    });

    it('applyCoupon: chưa đủ đơn tối thiểu cả khi tính hàng giờ vàng → giữ nguyên lỗi, không nhắc giờ vàng', async () => {
      const validateAndCompute = jest.fn().mockRejectedValue(new CouponMinOrderError(400000, 165000));
      const err = await new CartService(flashCart(null), { validateAndCompute } as any, config, flashSvc, analytics)
        .applyCoupon('u1', 'XANH10')
        .catch((e: Error) => e);
      expect((err as Error).message).toBe('Đơn tối thiểu 400.000đ để dùng mã này.');
    });

    describe('mã mua chung gắn sản phẩm (GBUY) khi giỏ có hàng giờ vàng', () => {
      const line = (id: string, productId: string, quantity: number, price: number) => ({
        id: `ci-${id}`,
        variationId: id,
        quantity,
        variation: { isActive: true, productId, salePrice: null, retailPrice: price, stock: 9, name: id, product: { name: id, slug: id, thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
      });
      const cartOf = (items: unknown[]) =>
        ({
          cart: {
            upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1', couponCode: null, items }),
            update: jest.fn().mockResolvedValue({}),
          },
        }) as any;
      const realCoupons = () =>
        new CouponsService({
          coupon: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'cg', code: 'GBUY1', type: 'AMOUNT', value: 30000, minOrder: 200000, maxDiscount: null, isActive: true,
              scope: 'PUBLIC', scopeMeta: null, applyTo: { productIds: ['pG'] },
              startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), perUserLimit: 1, usageLimit: null,
            }),
          },
          couponRedemption: { count: jest.fn().mockResolvedValue(0) },
          user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', tierId: null, phone: '0912345678', zaloId: 'z1' }) },
        } as unknown as PrismaService);

      it('sản phẩm của mã không có giá giờ vàng, hàng khác đang giờ vàng → lỗi đơn tối thiểu nguyên văn, không nêu số tiền mâu thuẫn', async () => {
        const prisma = cartOf([line('vF', 'pF', 2, 90000), line('vG', 'pG', 1, 165000), line('vX', 'pX', 1, 100000)]);
        const fs = { resolveEffective: jest.fn().mockResolvedValue(new Map([['vF', { flashPrice: 69000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])) } as any;
        const err = await new CartService(prisma, realCoupons(), config, fs, analytics).applyCoupon('u1', 'GBUY1').catch((e: Error) => e);
        expect((err as Error).message).toBe('Đơn tối thiểu 200.000đ để dùng mã này.');
        expect(prisma.cart.update).not.toHaveBeenCalled();
      });

      it('R4-CHECKOUT-3: sản phẩm của mã chỉ có trong giỏ ở giá giờ vàng → nói sản phẩm đang giờ vàng, không nói giỏ chưa có sản phẩm đó', async () => {
        const prisma = cartOf([line('vG', 'pG', 1, 140000), line('vX', 'pX', 1, 300000)]);
        const fs = { resolveEffective: jest.fn().mockResolvedValue(new Map([['vG', { flashPrice: 120000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])) } as any;
        const err = await new CartService(prisma, realCoupons(), config, fs, analytics).applyCoupon('u1', 'GBUY1').catch((e: Error) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toBe(COUPON_PRODUCT_FLASH_REASON);
        expect((err as Error).message).not.toContain('chưa có sản phẩm đó');
        expect(prisma.cart.update).not.toHaveBeenCalled();
      });

      it('R4-CHECKOUT-3: sản phẩm của mã không có trong giỏ (dù giỏ có hàng giờ vàng khác) → giữ câu "Giỏ hàng chưa có sản phẩm đó"', async () => {
        const prisma = cartOf([line('vF', 'pF', 1, 140000), line('vX', 'pX', 1, 300000)]);
        const fs = { resolveEffective: jest.fn().mockResolvedValue(new Map([['vF', { flashPrice: 120000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])) } as any;
        const err = await new CartService(prisma, realCoupons(), config, fs, analytics).applyCoupon('u1', 'GBUY1').catch((e: Error) => e);
        expect((err as Error).message).toBe('Mã này chỉ áp dụng khi mua đúng sản phẩm của chương trình. Giỏ hàng chưa có sản phẩm đó.');
      });

      it('chính sản phẩm của mã có dòng giờ vàng → nhắc giờ vàng, phần được tính là dòng sản phẩm đó giá thường', async () => {
        const prisma = cartOf([line('vG1', 'pG', 2, 90000), line('vG2', 'pG', 1, 100000), line('vX', 'pX', 1, 300000)]);
        const fs = { resolveEffective: jest.fn().mockResolvedValue(new Map([['vG1', { flashPrice: 69000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])) } as any;
        const err = await new CartService(prisma, realCoupons(), config, fs, analytics).applyCoupon('u1', 'GBUY1').catch((e: Error) => e);
        expect((err as Error).message).toBe(
          'Đơn tối thiểu 200.000đ để dùng mã này. Hàng giờ vàng không được tính vào điều kiện của mã, phần được tính là 100.000đ.',
        );
      });
    });

    it('applyCoupon bị từ chối khi giỏ không có hàng giờ vàng: giữ nguyên lỗi', async () => {
      const couponsSvc = { validateAndCompute: jest.fn().mockRejectedValue(new BadRequestException('Đơn tối thiểu 250.000đ để dùng mã này.')) } as any;
      const noFlash = { resolveEffective: jest.fn().mockResolvedValue(new Map()) } as any;
      await expect(new CartService(flashCart(null), couponsSvc, config, noFlash, analytics).applyCoupon('u1', 'XANH10')).rejects.toThrow(
        /^Đơn tối thiểu 250.000đ để dùng mã này.$/,
      );
    });

    it('getCart: mã đã áp nhưng có hàng giờ vàng → couponNotice nói mã chỉ giảm trên phần hàng còn lại', async () => {
      const couponsSvc = { validateAndCompute: jest.fn().mockResolvedValue({ discount: 16500, freeship: false }) } as any;
      const c = await new CartService(flashCart('XANH10'), couponsSvc, config, flashSvc, analytics).getCart('u1');
      expect(c.discount).toBe(16500);
      expect(c.couponNotice).toBe('Hàng giờ vàng không được giảm thêm theo mã: mã chỉ tính trên 165.000đ hàng còn lại.');
    });
  });

  it('getCart: coupon fail trên base-không-flash NHƯNG hợp lệ trên TOÀN giỏ → GIỮ mã, discount 0, KHÔNG null', async () => {
    const validateAndCompute = jest
      .fn()
      // CouponsService.validateAndCompute LUÔN ném BadRequestException cho lỗi business rule
      // (coupons.service.ts) — mock đúng loại lỗi này để khớp catch mới trong getCart(), vốn chỉ
      // coi BadRequestException là "coupon invalid" và rethrow mọi lỗi khác (hạ tầng).
      .mockRejectedValueOnce(new BadRequestException('minOrder')) // gọi với couponBase (loại flash)
      .mockResolvedValueOnce({ discount: 0, freeship: false }); // gọi lại với subtotal đầy đủ
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: 'SALE',
          items: [
            {
              id: 'ci1',
              variationId: 'v1',
              quantity: 1,
              variation: { isActive: true, productId: 'p1', salePrice: null, retailPrice: 100000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 1,
              variation: { isActive: true, productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
          ],
        }),
        update,
      },
    } as any;
    const flashSvc = {
      resolveEffective: jest
        .fn()
        .mockResolvedValue(new Map([['v1', { flashPrice: 80000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])),
    } as any;
    const couponsSvc = { validateAndCompute } as any;
    const cart = await new CartService(prisma, couponsSvc, config, flashSvc, analytics).getCart('u1');
    expect(cart.couponCode).toBe('SALE'); // GIỮ mã (flash chỉ tạm thời kéo base xuống)
    expect(cart.discount).toBe(0);
    expect(update).not.toHaveBeenCalled(); // KHÔNG null hoá coupon
    // MONEY-3: giỏ nói rõ mã đang giữ nhưng CHƯA áp (vì hàng giờ vàng không được tính).
    expect(cart.couponNotice).toContain('Mã chưa được áp dụng');
    expect(cart.couponNotice).toContain('giờ vàng');
    expect(cart.couponNotice).toContain('minOrder');
    expect(cart.couponRemoved).toBeNull();
  });

  describe('mã trong giỏ: sản phẩm của mã đang giờ vàng (R4-CHECKOUT-3), mã bị gỡ khỏi giỏ (R4-CHECKOUT-4)', () => {
    const cartWith = (couponCode: string) =>
      ({
        cart: {
          upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'c1',
            couponCode,
            items: [
              { id: 'ci1', variationId: 'vG', quantity: 1, variation: { isActive: true, productId: 'pG', salePrice: null, retailPrice: 140000, stock: 5, name: 'G', product: { name: 'Granola', slug: 'g', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } } },
              { id: 'ci2', variationId: 'vX', quantity: 1, variation: { isActive: true, productId: 'pX', salePrice: null, retailPrice: 90000, stock: 5, name: 'X', product: { name: 'X', slug: 'x', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } } },
            ],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      }) as any;
    const flashG = { resolveEffective: jest.fn().mockResolvedValue(new Map([['vG', { flashPrice: 120000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])) } as any;
    const couponsWith = (coupon: Record<string, unknown>) =>
      new CouponsService({
        coupon: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'cp', type: 'AMOUNT', value: 20000, minOrder: null, maxDiscount: null, isActive: true, scope: 'PUBLIC', scopeMeta: null,
            startAt: new Date(Date.now() - 864e5), endAt: new Date(Date.now() + 864e5), perUserLimit: 1, usageLimit: null, ...coupon,
          }),
        },
        couponRedemption: { count: jest.fn().mockResolvedValue(0) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: '0912345678', zaloId: 'z1' }) },
      } as unknown as PrismaService);

    it('mã gắn sản phẩm đang giờ vàng: giữ mã, lời báo nói sản phẩm đang giờ vàng, không nói giỏ chưa có sản phẩm đó', async () => {
      const prisma = cartWith('PSGRAN');
      const c = await new CartService(prisma, couponsWith({ code: 'PSGRAN', applyTo: { productIds: ['pG'] } }), config, flashG, analytics).getCart('u1');
      expect(c.couponCode).toBe('PSGRAN');
      expect(c.discount).toBe(0);
      expect(c.couponNotice).toContain(COUPON_PRODUCT_FLASH_REASON);
      expect(c.couponNotice).not.toContain('chưa có sản phẩm đó');
      expect(prisma.cart.update).not.toHaveBeenCalled();
    });

    it('mã bị admin tắt: gỡ khỏi giỏ và cho biết mã nào bị gỡ, vì sao (checkout dùng để giải thích tổng tăng)', async () => {
      const prisma = cartWith('TAT50');
      const c = await new CartService(prisma, couponsWith({ code: 'TAT50', isActive: false }), config, flashG, analytics).getCart('u1');
      expect(c.couponCode).toBeNull();
      expect(c.couponRemoved).toEqual({ code: 'TAT50', reason: 'Mã giảm giá đã ngừng áp dụng.' });
      expect(prisma.cart.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { couponCode: null } });
    });
  });

  describe('getCart: mã hợp lệ nhưng giảm 0đ (giỏ toàn hàng giờ vàng, mã không có đơn tối thiểu)', () => {
    const allFlashCart = (validateAndCompute: jest.Mock) => {
      const prisma = {
        cart: {
          upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'c1',
            couponCode: 'BDAY50K',
            items: [
              {
                id: 'ci1',
                variationId: 'v1',
                quantity: 1,
                variation: { isActive: true, productId: 'p1', salePrice: null, retailPrice: 300000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
              },
            ],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
      } as any;
      const flashSvc = {
        resolveEffective: jest
          .fn()
          .mockResolvedValue(new Map([['v1', { flashPrice: 200000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10 }]])),
      } as any;
      return new CartService(prisma, { validateAndCompute } as any, config, flashSvc, analytics).getCart('u1');
    };

    it('giữ mã, giảm 0đ, kèm couponNotice nói mã chưa được áp', async () => {
      const cart = await allFlashCart(jest.fn().mockResolvedValue({ discount: 0, freeship: false }));
      expect(cart.couponCode).toBe('BDAY50K');
      expect(cart.discount).toBe(0);
      expect(cart.couponNotice).toMatch(/^Mã chưa được áp dụng cho đơn này/);
      expect(cart.couponNotice).toContain('giờ vàng');
    });

    it('mã miễn phí vận chuyển → không có couponNotice', async () => {
      const cart = await allFlashCart(jest.fn().mockResolvedValue({ discount: 0, freeship: true }));
      expect(cart.freeship).toBe(true);
      expect(cart.couponNotice).toBeNull();
    });
  });

  it('getCart: coupon fail cả trên TOÀN giỏ (hết hạn/hết lượt) → GỠ mã (null)', async () => {
    const validateAndCompute = jest.fn().mockRejectedValue(new BadRequestException('expired'));
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: 'SALE',
          items: [
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 1,
              variation: { isActive: true, productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
          ],
        }),
        update,
      },
    } as any;
    const flashSvc = { resolveEffective: jest.fn().mockResolvedValue(new Map()) } as any;
    const couponsSvc = { validateAndCompute } as any;
    const cart = await new CartService(prisma, couponsSvc, config, flashSvc, analytics).getCart('u1');
    expect(cart.couponCode).toBeNull();
    expect(update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { couponCode: null } });
  });

  it('getCart: lỗi hạ tầng (không phải BadRequestException) khi validate coupon → KHÔNG bị nuốt, KHÔNG gỡ mã', async () => {
    // Lỗi transient (DB timeout/connection blip) khác hẳn "coupon invalid" — trước đây bị catch{}
    // rỗng nuốt luôn và xoá coupon hợp lệ khỏi giỏ. Giờ phải rethrow, không đụng tới couponCode.
    const infraError = new Error('ECONNRESET');
    const validateAndCompute = jest.fn().mockRejectedValue(infraError);
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 'c1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'c1',
          couponCode: 'SALE',
          items: [
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 1,
              variation: { isActive: true, productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null, isActive: true, approvalStatus: 'APPROVED' } },
            },
          ],
        }),
        update,
      },
    } as any;
    const flashSvc = { resolveEffective: jest.fn().mockResolvedValue(new Map()) } as any;
    const couponsSvc = { validateAndCompute } as any;
    await expect(new CartService(prisma, couponsSvc, config, flashSvc, analytics).getCart('u1')).rejects.toBe(infraError);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CartService.clearOrdered (dọn giỏ sau khi đặt cả giỏ)', () => {
  it('chỉ xoá các dòng đã vào đơn và bỏ mã giảm giá', async () => {
    const tx = {
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }), update: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
    };
    await new CartService({} as PrismaService, coupons, config, flash, analytics).clearOrdered('u1', ['i1', 'i2'], tx as never);
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 'c1', id: { in: ['i1', 'i2'] } } });
    expect(tx.cart.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { couponCode: null } });
  });
});
