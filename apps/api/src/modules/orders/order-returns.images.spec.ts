import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { OrderReturnsService, RETURN_LIST_SELECT } from './order-returns.service';
import { returnImageRef } from './return-images';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

// R3-UI-1: danh sách yêu cầu trả hàng (khách, admin, gian hàng) không nhúng ảnh base64; ảnh tải riêng qua /returns/:id/images/:i.
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const HEAVY = `data:image/jpeg;base64,${Buffer.alloc(30_000, 7).toString('base64')}`;
const HTTPS = 'https://res.cloudinary.com/demo/image/upload/v1/returns/a.jpg';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const v = (id: string, idx: number, image: string) => md5(`${id}:${idx}:${image}`);
const refRows = [
  { id: 'r1', idx: 0, hash: v('r1', 0, HEAVY), url: null },
  { id: 'r1', idx: 1, hash: null, url: HTTPS },
];
const row = (over: Record<string, unknown> = {}) => ({ id: 'r1', orderId: 'o1', userId: 'u1', reasonCode: null, items: [], ...over });
const build = (prisma: unknown) =>
  new OrderReturnsService(prisma as PrismaService, {} as never, {} as never, {} as never, {} as never, notifications);

describe('RETURN_LIST_SELECT', () => {
  it('đủ mọi cột của ReturnRequest trừ images (cột mới không bị bỏ sót), kèm items', () => {
    const scalars = Object.values(Prisma.ReturnRequestScalarFieldEnum).filter((f) => f !== 'images');
    expect(Object.keys(RETURN_LIST_SELECT).sort()).toEqual([...scalars, 'items'].sort());
    expect(RETURN_LIST_SELECT).not.toHaveProperty('images');
  });
});

describe('returnImageRef', () => {
  it('ảnh data URL → đường dẫn kèm mã md5 nội dung; ảnh https giữ nguyên', () => {
    expect(returnImageRef('r1', 2, HEAVY)).toBe(`/returns/r1/images/2?v=${v('r1', 2, HEAVY)}`);
    expect(returnImageRef('r1', 0, HTTPS)).toBe(HTTPS);
  });
});

describe('OrderReturnsService — ảnh minh chứng không nhúng base64 trong danh sách (R3-UI-1)', () => {
  it('listMine: không đọc cột images, trả đường dẫn ảnh, JSON nhẹ không chứa base64', async () => {
    const findMany = jest.fn().mockResolvedValue([row()]);
    const svc = build({ returnRequest: { findMany }, $queryRaw: jest.fn().mockResolvedValue(refRows) });
    const out = await svc.listMine('u1');
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' }, take: 50, select: RETURN_LIST_SELECT });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty('include');
    expect(out[0]!.images).toEqual([`/returns/r1/images/0?v=${v('r1', 0, HEAVY)}`, HTTPS]);
    expect(JSON.stringify(out)).not.toContain('base64');
  });

  it('listMine: yêu cầu không có ảnh → images rỗng', async () => {
    const svc = build({ returnRequest: { findMany: jest.fn().mockResolvedValue([row()]) }, $queryRaw: jest.fn().mockResolvedValue([]) });
    expect((await svc.listMine('u1'))[0]!.images).toEqual([]);
  });

  it('listMine: không có yêu cầu nào → không gọi truy vấn ảnh', async () => {
    const queryRaw = jest.fn();
    const svc = build({ returnRequest: { findMany: jest.fn().mockResolvedValue([]) }, $queryRaw: queryRaw });
    expect(await svc.listMine('u1')).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('listForAdmin: không đọc cột images; mỗi yêu cầu mang đường dẫn ảnh, không base64; một truy vấn ảnh cho cả trang', async () => {
    const findMany = jest.fn().mockResolvedValue([row(), row({ id: 'r2' })]);
    const queryRaw = jest.fn().mockResolvedValue(refRows);
    const svc = build({
      returnRequest: { findMany, count: jest.fn().mockResolvedValue(2) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      orderCustomerRefund: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: queryRaw,
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    });
    const res = (await svc.listForAdmin('REQUESTED', 1, 100)) as { data: { id: string; images: string[] }[] };
    expect(findMany.mock.calls[0][0].select).toBe(RETURN_LIST_SELECT);
    expect(res.data[0]!.images).toEqual([`/returns/r1/images/0?v=${v('r1', 0, HEAVY)}`, HTTPS]);
    expect(res.data[1]!.images).toEqual([]);
    expect(JSON.stringify(res)).not.toContain('base64');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('request: phản hồi tạo yêu cầu không trả lại base64 vừa gửi', async () => {
    const create = jest.fn(async ({ data }: { data: object }) => ({ id: 'r1', ...data, items: [] }));
    const order = {
      id: 'o1', code: 'TUBU1', userId: 'u1', type: 'RETAIL', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID',
      placedForCustomer: false, total: 100_000, shippingFee: 0, deliveredAt: new Date(), updatedAt: new Date(), createdAt: new Date(),
      items: [{ id: 'a', orderId: 'o1', variationId: 'v', productName: 'SP', variationName: 'M', unitPrice: 100_000, quantity: 1, total: 100_000 }],
    };
    const svc = new OrderReturnsService(
      {
        order: { findUnique: jest.fn().mockResolvedValue(order) },
        orderStatusHistory: { findFirst: jest.fn().mockResolvedValue(null) },
        returnRequest: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create },
      } as unknown as PrismaService,
      { get: async <T>(_k: string, fb?: T) => fb as T } as never,
      {} as never,
      {} as never,
      {} as never,
      notifications,
    );
    const out = await svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', images: [HEAVY, HTTPS], items: [{ orderItemId: 'a', quantity: 1 }] });
    expect(create.mock.calls[0]![0].data).toMatchObject({ images: [HEAVY, HTTPS] });
    expect(create.mock.calls[0]![0]).toMatchObject({ select: RETURN_LIST_SELECT });
    expect(out.images).toEqual([`/returns/r1/images/0?v=${v('r1', 0, HEAVY)}`, HTTPS]);
    expect(JSON.stringify(out)).not.toContain('base64');
  });

  it('listForMerchant: ảnh cũng là đường dẫn, không nhúng base64', async () => {
    const prisma = {
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 'sf1' }) },
      $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'r1' }]).mockResolvedValueOnce(refRows),
      returnRequest: {
        findMany: jest.fn().mockResolvedValue([
          row({ status: 'REQUESTED', createdAt: new Date(), reviewedAt: null, receivedAt: null, reason: 'Hỏng', fullReturn: false, shopFault: null, items: [{ orderItemId: 'a', quantity: 1 }] }),
        ]),
      },
      order: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', code: 'TUBU1', items: [{ id: 'a', productName: 'Bưởi', variationName: null, quantity: 1 }] }]) },
    };
    const rows = await build(prisma).listForMerchant('shop-owner');
    expect(prisma.returnRequest.findMany.mock.calls[0]![0].select).toBe(RETURN_LIST_SELECT);
    expect(rows[0]!.images).toEqual([`/returns/r1/images/0?v=${v('r1', 0, HEAVY)}`, HTTPS]);
    expect(JSON.stringify(rows)).not.toContain('base64');
  });
});

describe('OrderReturnsService.getImage', () => {
  const B64 = 'iVBORw0KGgo=';
  const PNG = `data:image/png;base64,${B64}`;
  const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  const svcWith = (image: string | null) => build({ $queryRaw: jest.fn().mockResolvedValue(image === null ? [] : [{ img: image }]) });

  it('đúng mã v → trả loại ảnh và byte', async () => {
    const img = await svcWith(PNG).getImage('r1', 0, v('r1', 0, PNG));
    expect(img.mime).toBe('image/png');
    expect(img.data.equals(Buffer.from(B64, 'base64'))).toBe(true);
  });

  it.each<[string, string | null, number, string | undefined]>([
    ['sai mã v', PNG, 0, 'f'.repeat(32)],
    ['thiếu mã v', PNG, 0, undefined],
    ['mã v khác độ dài', PNG, 0, 'abc'],
    ['yêu cầu/ảnh không tồn tại', null, 0, v('r1', 0, PNG)],
    ['chỉ số âm', PNG, -1, v('r1', -1, PNG)],
    ['chỉ số quá lớn', PNG, 99, v('r1', 99, PNG)],
    ['ảnh https không phục vụ qua endpoint', HTTPS, 0, v('r1', 0, HTTPS)],
    ['ảnh SVG', SVG, 0, v('r1', 0, SVG)],
    ['mã v của ảnh khác chỉ số', PNG, 0, v('r1', 1, PNG)],
    ['mã v của yêu cầu khác', PNG, 0, v('r2', 0, PNG)],
  ])('%s → 404 chung một câu', async (_name, image, index, ver) => {
    await expect(svcWith(image).getImage('r1', index, ver)).rejects.toThrow('Không tìm thấy ảnh.');
  });
});
