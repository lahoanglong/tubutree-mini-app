import { Prisma } from '@prisma/client';
import { BUYER_HIDDEN_ORDER_FIELDS, BUYER_VISIBLE_SYNC_FIELDS, forBuyer } from './buyer-order-fields';

const SYNC_COLUMN = /^(pancake|gomdon)/;
const orderColumns: string[] = Object.values(Prisma.OrderScalarFieldEnum);
const hidden = new Set<string>(BUYER_HIDDEN_ORDER_FIELDS);
const visible = new Set<string>(BUYER_VISIBLE_SYNC_FIELDS);

describe('forBuyer — cột đồng bộ Pancake/Gomdon của Order (R5-SYNC-4)', () => {
  it('mọi cột pancake*/gomdon* của model Order đều đã được xếp loại ẩn hay hiện cho người mua', () => {
    const unclassified = orderColumns.filter((c) => SYNC_COLUMN.test(c) && !hidden.has(c) && !visible.has(c));
    expect(unclassified).toEqual([]);
  });

  it('hai danh sách không chồng nhau và chỉ nêu cột có thật của Order', () => {
    expect([...visible].filter((c) => hidden.has(c))).toEqual([]);
    expect([...hidden, ...visible].filter((c) => !orderColumns.includes(c))).toEqual([]);
  });

  it('danh sách hiện chỉ gồm cột đồng bộ (cột khác hiện theo mặc định, không cần nêu)', () => {
    expect([...visible].filter((c) => !SYNC_COLUMN.test(c))).toEqual([]);
  });

  it('pancakePaidReported (số tiền đã báo Pancake để đối soát) không tới người mua', () => {
    const out = forBuyer({ code: 'TUBU1', total: 100_000, pancakePaidReported: 100_000 }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('pancakePaidReported');
    expect(out).toMatchObject({ code: 'TUBU1', total: 100_000 });
  });

  it('cột pancake*/gomdon* chưa xếp loại bị ẩn theo mặc định; cột vận đơn Gomdon khách đọc vẫn còn', () => {
    const out = forBuyer({
      code: 'TUBU1',
      pancakeSomethingNew: 'x',
      gomdonSomethingNew: 1,
      gomdonOrderId: 'g1',
      gomdonPartnerCode: 'BE1',
      gomdonStatus: '3',
      gomdonCancelStatus: null,
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('pancakeSomethingNew');
    expect(out).not.toHaveProperty('gomdonSomethingNew');
    expect(out).toMatchObject({ gomdonOrderId: 'g1', gomdonPartnerCode: 'BE1', gomdonStatus: '3', gomdonCancelStatus: null });
  });
});
