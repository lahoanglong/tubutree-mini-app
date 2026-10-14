/* Fake Prisma tối thiểu cho spec chiều Tubu → Pancake: một bảng orders trong bộ nhớ, where hỗ trợ đúng phần
 * PancakeOrderService/PancakeSyncHooks dùng (bằng, null, not, lt, startsWith, OR, NOT). Không dùng ngoài spec. */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matchField(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>;
    if ('not' in c) {
      if (c.not === null) return value !== null && value !== undefined;
      if (value === null || value === undefined) return false;
      return value !== c.not;
    }
    if ('lt' in c) return value instanceof Date && value.getTime() < (c.lt as Date).getTime();
    if ('startsWith' in c) return typeof value === 'string' && value.startsWith(c.startsWith as string);
    if ('in' in c) return (c.in as unknown[]).includes(value);
    throw new Error(`fake prisma: điều kiện chưa hỗ trợ ${JSON.stringify(c)}`);
  }
  return value === cond;
}

export function matchWhere(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Where[]).some((w) => matchWhere(row, w));
    if (k === 'AND') return (cond as Where[]).every((w) => matchWhere(row, w));
    if (k === 'NOT') return !matchWhere(row, cond as Where);
    return matchField(row[k], cond);
  });
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in (v as Row)) {
      row[k] = ((row[k] as number) ?? 0) + ((v as Row).increment as number);
    } else {
      row[k] = v;
    }
  }
}

export function fakeOrderDb(initial: Row[], extra: Record<string, unknown> = {}) {
  const rows = initial.map((r) => ({ ...r }));
  const find = (where: Where) => rows.find((r) => matchWhere(r, where)) ?? null;
  const order = {
    findUniqueOrThrow: jest.fn(async ({ where }: { where: Where }) => {
      const r = find(where);
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    findUnique: jest.fn(async ({ where }: { where: Where }) => {
      const r = find(where);
      return r ? { ...r } : null;
    }),
    findFirst: jest.fn(async ({ where }: { where: Where }) => {
      const r = find(where);
      return r ? { ...r } : null;
    }),
    update: jest.fn(async ({ where, data }: { where: Where; data: Row }) => {
      const r = find(where);
      if (!r) throw new Error('not found');
      applyData(r, data);
      return { ...r };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Row }) => {
      const hit = rows.filter((r) => matchWhere(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    }),
  };
  const prisma = {
    order,
    variation: { findMany: jest.fn().mockResolvedValue([]) },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
    address: { findFirst: jest.fn().mockResolvedValue(null) },
    dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    ...extra,
  };
  return { prisma, rows, row: (id = rows[0]!.id) => rows.find((r) => r.id === id)! };
}

export function fakeQueue() {
  const added: { name: string; data: unknown; opts: unknown }[] = [];
  return {
    name: 'pancake-push',
    added,
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn(async (name: string, data: unknown, opts: unknown) => {
      added.push({ name, data, opts });
      return {};
    }),
  };
}

export function baseOrder(overrides: Row = {}): Row {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    type: 'RETAIL',
    platform: 'miniapp',
    status: 'CONFIRMED',
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    subtotal: 200_000,
    discount: 0,
    shippingFee: 30_000,
    total: 230_000,
    pancakeOrderId: null,
    pancakePushStatus: null,
    pancakeSyncError: null,
    pancakePushAttempts: 0,
    pancakeLastAttemptAt: null,
    pancakePushClaimedAt: null,
    pancakePaymentSynced: false,
    pancakeCancelStatus: null,
    pancakeAttention: null,
    pancakeAttentionAt: null,
    shippingAddress: {
      recipient: 'Nguyễn Văn A',
      phone: '0900000001',
      street: '1 Lê Lợi',
      ward: 'Phường Bến Thành',
      district: '',
      province: 'TP. Hồ Chí Minh',
      provinceCode: '84_VN79',
      districtCode: '',
      wardCode: '84_VN7926743',
    },
    invoiceRequest: null,
    hasRecyclingPickup: false,
    recyclingNote: null,
    gomdonPartnerCode: null,
    gomdonStatus: null,
    items: [{ id: 'i1', variationId: 'v1', quantity: 2, unitPrice: 100_000 }],
    ...overrides,
  };
}
