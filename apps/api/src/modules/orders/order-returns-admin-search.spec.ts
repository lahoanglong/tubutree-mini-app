import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { OrderReturnsService, RETURNS_TO_RECEIVE } from './order-returns.service';
import { ReturnRequestsQuery, ReturnsAdminController } from './returns-admin.controller';

// Ô tìm của tab Đổi/trả: mã đơn chính xác hoặc SĐT/tên khách; không có ô tìm thì danh sách như cũ.
function setup(over: { orders?: { id: string }[]; users?: { id: string }[] } = {}) {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const queryRaw = jest.fn().mockResolvedValue([]);
  const orderFindMany = jest.fn().mockResolvedValue(over.orders ?? []);
  const userFindMany = jest.fn().mockResolvedValue(over.users ?? []);
  const prisma = {
    returnRequest: { findMany, count },
    order: { findMany: orderFindMany },
    user: { findMany: userFindMany },
    orderCustomerRefund: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: queryRaw,
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  const svc = new OrderReturnsService(prisma as never, {} as never, {} as never, {} as never, {} as never, { notify: jest.fn(), notifySafe: jest.fn() } as never);
  return { svc, findMany, count, queryRaw, orderFindMany, userFindMany };
}

describe('OrderReturnsService.listForAdmin — ô tìm theo mã đơn hoặc SĐT', () => {
  it('không có q, q rỗng hoặc chỉ "#": điều kiện như cũ, không tra đơn hay khách', async () => {
    const { svc, findMany, orderFindMany, userFindMany } = setup();
    await svc.listForAdmin('REQUESTED', 1, 20);
    await svc.listForAdmin('REQUESTED', 1, 20, 'asc', '  ');
    await svc.listForAdmin('REQUESTED', 1, 20, 'asc', '#');
    for (const call of findMany.mock.calls) expect(call[0].where).toEqual({ status: 'REQUESTED' });
    expect(orderFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it('mã đơn (kèm #, gõ thường): tra đơn theo mã chính xác rồi lọc theo orderId; số đếm cùng điều kiện', async () => {
    const { svc, findMany, count, orderFindMany } = setup({ orders: [{ id: 'o1' }] });
    await svc.listForAdmin('REQUESTED', 1, 20, 'asc', '#tubu123');
    expect(orderFindMany.mock.calls[0][0].where).toEqual({ code: { in: ['tubu123', 'TUBU123'] } });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toEqual({ status: 'REQUESTED', OR: [{ orderId: { in: ['o1'] } }, { userId: { in: [] } }] });
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('SĐT: khớp khách qua bảng users rồi lọc theo userId của yêu cầu', async () => {
    const { svc, findMany, userFindMany } = setup({ users: [{ id: 'u7' }] });
    await svc.listForAdmin(undefined, 1, 20, 'desc', '0901 234 567');
    expect(userFindMany.mock.calls[0][0].where.OR).toContainEqual({ phone: { contains: '0901234567' } });
    expect(findMany.mock.calls[0][0].where).toEqual({ OR: [{ orderId: { in: [] } }, { userId: { in: ['u7'] } }] });
  });

  it('không khớp gì thì rỗng (in: []), không phải mọi yêu cầu', async () => {
    const { svc, findMany } = setup();
    await svc.listForAdmin('REQUESTED', 1, 20, 'asc', 'khongco');
    expect(findMany.mock.calls[0][0].where).toEqual({ status: 'REQUESTED', OR: [{ orderId: { in: [] } }, { userId: { in: [] } }] });
  });

  it('hàng "Chờ nhận hàng về" cũng lọc theo q trong câu SQL', async () => {
    const { svc, queryRaw } = setup({ orders: [{ id: 'o1' }], users: [{ id: 'u1' }] });
    await svc.listForAdmin(RETURNS_TO_RECEIVE, 1, 20, 'asc', 'TUBU1');
    const from = queryRaw.mock.calls[0]![1] as { sql: string; values: unknown[] };
    expect(from.sql).toContain('rr."orderId" = ANY');
    expect(from.sql).toContain('rr."userId" = ANY');
    const plain = setup();
    await plain.svc.listForAdmin(RETURNS_TO_RECEIVE, 1, 20, 'asc');
    expect((plain.queryRaw.mock.calls[0]![1] as { sql: string }).sql).not.toContain('ANY');
  });
});

describe('ReturnsAdminController — q', () => {
  it('chuyển q xuống listForAdmin; ReturnRequestsQuery nhận q tối đa 100 ký tự', async () => {
    const returns = { listForAdmin: jest.fn().mockResolvedValue({ data: [] }) };
    const ctl = new ReturnsAdminController(returns as never);
    await ctl.list(Object.assign(new ReturnRequestsQuery(), { page: 1, limit: 20, status: 'REQUESTED', order: 'asc', q: 'TUBU1' }));
    expect(returns.listForAdmin).toHaveBeenCalledWith('REQUESTED', 1, 20, 'asc', 'TUBU1');
    expect(await validate(plainToInstance(ReturnRequestsQuery, { q: 'TUBU1' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ReturnRequestsQuery, { q: 'a'.repeat(101) }))).map((e) => e.property)).toEqual(['q']);
  });
});
