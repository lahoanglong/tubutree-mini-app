import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CouponsService } from '../coupons/coupons.service';
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
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { approvalStatus: 'PENDING_REVIEW' } }),
      },
    } as unknown as PrismaService;
    const svc = new CartService(prisma, coupons, config, flash, analytics);
    await expect(svc.addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow('không khả dụng');
    const rejected = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { approvalStatus: 'REJECTED' } }),
      },
    } as unknown as PrismaService;
    await expect(new CartService(rejected, coupons, config, flash, analytics).addItem('u1', { variationId: 'v1', quantity: 1 })).rejects.toThrow(
      'không khả dụng',
    );
  });

  it('addItem: chặn khi tổng số lượng vượt tồn kho', async () => {
    const prisma = {
      cart: { upsert: jest.fn().mockResolvedValue({ id: 'c1' }) },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, stock: 3, product: { approvalStatus: 'APPROVED' } }),
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
          .mockResolvedValue({ id: 'v1', isActive: true, stock: 10, product: { approvalStatus: 'APPROVED' } }),
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
      subtotal: 0,
      discount: 0,
      freeship: false,
      freeshipThreshold: 200000,
      itemCount: 0,
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
          .mockResolvedValue({ id: 'v1', isActive: true, stock: 10, product: { approvalStatus: 'APPROVED' } }),
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
                productId: 'p1',
                salePrice: null,
                retailPrice: 100000,
                stock: 5,
                name: 'A',
                product: { name: 'A', slug: 'a', thumbnail: null },
              },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 2,
              variation: {
                productId: 'p2',
                salePrice: null,
                retailPrice: 50000,
                stock: 5,
                name: 'B',
                product: { name: 'B', slug: 'b', thumbnail: null },
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
    expect(validateAndCompute).toHaveBeenCalledWith('SALE', 'u1', 100000);
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
                productId: 'p1',
                salePrice: null,
                retailPrice: 60000,
                stock: 5,
                name: 'A',
                product: { name: 'A', slug: 'a', thumbnail: null },
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
              variation: { productId: 'p1', salePrice: null, retailPrice: 100000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null } },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 2,
              variation: { productId: 'p2', salePrice: null, retailPrice: 50000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null } },
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
    await new CartService(prisma, couponsSvc, config, flashSvc, analytics).applyCoupon('u1', 'SAVE');
    // subtotal đầy đủ = v1(80000)+v2(100000)=180000; base KHÔNG flash = v2 = 100000
    expect(validateAndCompute).toHaveBeenCalledWith('SAVE', 'u1', 100000);
    expect(validateAndCompute).not.toHaveBeenCalledWith('SAVE', 'u1', 180000);
    expect(prisma.cart.update).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { couponCode: 'SAVE' } });
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
              variation: { productId: 'p1', salePrice: null, retailPrice: 100000, stock: 5, name: 'A', product: { name: 'A', slug: 'a', thumbnail: null } },
            },
            {
              id: 'ci2',
              variationId: 'v2',
              quantity: 1,
              variation: { productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null } },
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
              variation: { productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null } },
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
              variation: { productId: 'p2', salePrice: null, retailPrice: 30000, stock: 5, name: 'B', product: { name: 'B', slug: 'b', thumbnail: null } },
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
