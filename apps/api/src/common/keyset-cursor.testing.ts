type Row = { id: string; createdAt: Date; userId?: string };

/** Bảng giả trong bộ nhớ cho test phân trang keyset: hiểu `userId`, `AND` và điều kiện của `keysetAfter`, sắp `createdAt desc, id desc`. */
export function fakeKeysetTable<T extends Row>(rows: T[]) {
  const match = (row: T, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, cond]) => {
      if (key === 'AND') return (cond as Record<string, unknown>[]).every((w) => match(row, w));
      if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => match(row, w));
      const v = (row as Record<string, unknown>)[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const c = cond as { lt?: Date | string };
        if (c.lt === undefined) return true;
        return v instanceof Date ? v.getTime() < (c.lt as Date).getTime() : (v as string) < (c.lt as string);
      }
      return cond instanceof Date ? (v as Date).getTime() === cond.getTime() : v === cond;
    });
  };
  const sorted = () => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return {
    rows,
    findMany: jest.fn(async (args: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      sorted()
        .filter((r) => match(r, args.where))
        .slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? Infinity)),
    ),
    count: jest.fn(async (args: { where?: Record<string, unknown> }) => rows.filter((r) => match(r, args.where)).length),
  };
}
