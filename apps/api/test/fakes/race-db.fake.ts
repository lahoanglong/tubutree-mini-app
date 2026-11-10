/* eslint-disable @typescript-eslint/no-explicit-any -- giả lập client Prisma tạo model theo tên bảng lúc chạy nên kiểu dòng/where là động */
import { Prisma } from '@prisma/client';

/**
 * Cơ sở dữ liệu giả trong bộ nhớ cho test ĐUA (race) — mô phỏng đủ cách Postgres READ COMMITTED xử lý hai request chạm nhau,
 * để test thật sự thấy lỗ hổng thay vì chạy tuần tự rồi xanh giả:
 *
 *  - MỌI thao tác của model (find/create/update/...) và mọi câu raw đều `await tick()` TRƯỚC khi đọc/ghi, nên hai request xen kẽ nhau
 *    từng bước thay vì request 1 chạy hết rồi request 2 mới bắt đầu.
 *  - Mỗi transaction ghi vào lớp phủ riêng (overlay), chỉ thấy bởi chính nó tới lúc commit; người khác đọc bản đã commit (không dirty read).
 *    Ném lỗi trong callback = rollback, bỏ lớp phủ.
 *  - UPDATE/updateMany: chọn dòng theo WHERE lúc bắt đầu câu, rồi chờ khoá từng dòng; được khoá thì ĐỌC LẠI dòng mới nhất và xét lại WHERE
 *    (EvalPlanQual của Postgres), nên CAS có kiểm `count` an toàn còn đọc-rồi-ghi theo id thì không.
 *  - `$queryRaw`/`$executeRaw` chỉ khoá khi chính chuỗi SQL khớp /FOR (NO KEY )?UPDATE/ (handler nhận cờ `locking`); advisory lock do handler
 *    gọi `lockKey`. Sửa SQL gốc bỏ FOR UPDATE thì khoá biến mất theo.
 *  - Ràng buộc unique được thực thi (kể cả unique một phần qua `when`): INSERT trùng khoá đang giữ bởi transaction khác thì CHỜ transaction đó
 *    kết thúc rồi mới xét; trùng thật thì ném PrismaClientKnownRequestError P2002 và transaction rơi vào trạng thái aborted (mọi câu sau ném 25P02),
 *    đúng như Postgres. createMany({skipDuplicates}) = ON CONFLICT DO NOTHING (không abort).
 */
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

type Row = Record<string, any>;

export interface UniqueSpec {
  fields: string[];
  /** Unique một phần: chỉ dòng thoả điều kiện mới bị ràng buộc. */
  when?: (row: Row) => boolean;
}

export interface TableSpec {
  unique?: UniqueSpec[];
  /** Giá trị mặc định của cột khi INSERT không truyền (như @default trong schema): cần cho cột số mà service cộng trừ. */
  defaults?: Record<string, unknown>;
  /** Quan hệ để lọc lồng (`order: { status: 'DELIVERED' }`) và `include`: giá trị `row[fk]` trỏ tới `id` của bảng `table`. */
  relations?: Record<string, { table: string; fk: string }>;
}

export interface RawContext {
  sql: string;
  params: unknown[];
  /** SQL có chứa FOR UPDATE / FOR NO KEY UPDATE: handler chỉ được khoá dòng khi cờ này bật. */
  locking: boolean;
  db: RaceDb;
  /** Khoá dòng `table:id` tới hết transaction (autocommit thì tới hết câu). */
  lockRow(table: string, id: string): Promise<void>;
  /** Khoá tuỳ ý (advisory lock) tới hết transaction. */
  lockKey(key: string): Promise<void>;
  /** Dòng của bảng mà transaction này thấy (đã commit + lớp phủ của chính nó). */
  rows(table: string): Row[];
  /** Client gắn với transaction đang chạy: handler của câu UPDATE thô ghi qua đây để thay đổi nằm trong cùng transaction. */
  client: any;
}

export interface RawHandler {
  match: RegExp;
  run(c: RawContext): Promise<unknown> | unknown;
}

class Tx {
  overlay = new Map<string, Map<string, Row | null>>();
  held = new Set<string>();
  aborted = false;
  constructor(readonly auto: boolean) {}
}

const clone = <T>(v: T): T => (v instanceof Date ? (new Date(v.getTime()) as T) : v && typeof v === 'object' ? (Array.isArray(v) ? (v.map(clone) as T) : (Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, clone(x)])) as T)) : v);
const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const cmp = (a: any, b: any) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);

function scalarMatches(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (!isPlain(cond)) return same(v, cond);
  return Object.entries(cond).every(([op, arg]) => {
    if (arg === undefined) return true;
    switch (op) {
      case 'equals':
        return typeof arg === 'string' && (cond.mode === 'insensitive') ? String(v ?? '').toLowerCase() === arg.toLowerCase() : same(v, arg);
      case 'in':
        return (arg as any[]).some((x) => same(v, x));
      case 'notIn':
        return !(arg as any[]).some((x) => same(v, x));
      case 'not':
        return arg === null ? v !== null && v !== undefined : isPlain(arg) ? !scalarMatches(v, arg) : !same(v, arg);
      case 'gte':
        return v != null && cmp(v, arg) >= 0;
      case 'gt':
        return v != null && cmp(v, arg) > 0;
      case 'lte':
        return v != null && cmp(v, arg) <= 0;
      case 'lt':
        return v != null && cmp(v, arg) < 0;
      case 'startsWith':
        return typeof v === 'string' && v.startsWith(arg as string);
      case 'contains':
        return typeof v === 'string' && (cond.mode === 'insensitive' ? v.toLowerCase().includes(String(arg).toLowerCase()) : v.includes(arg as string));
      case 'mode':
        return true;
      default:
        throw new Error(`race-db: toán tử where chưa hỗ trợ: ${op}`);
    }
  });
}

export class RaceDb {
  private committed = new Map<string, Map<string, Row>>();
  private locks = new Map<string, { owner: Tx | null; queue: (() => void)[] }>();
  private seq = 0;
  readonly handlers: RawHandler[] = [];
  /** Số lần một câu phải chờ khoá của transaction khác: > 0 chứng minh test thật sự va chạm. */
  stats = { lockWaits: 0, rollbacks: 0, commits: 0 };
  /** Autocommit client (như `prisma` ngoài transaction) và là thứ truyền cho service. */
  readonly client: any;

  constructor(private readonly specs: Record<string, TableSpec>) {
    for (const name of Object.keys(specs)) this.committed.set(name, new Map());
    this.client = this.buildClient(null);
  }

  seed(table: string, rows: Row[]): void {
    for (const r of rows) {
      const row = { id: r.id ?? `${table}-${++this.seq}`, ...clone(r) };
      this.committed.get(table)!.set(row.id, row);
    }
  }

  /** Bản sao các dòng ĐÃ COMMIT (dùng để assert kết quả cuối). */
  rows(table: string): Row[] {
    return [...this.committed.get(table)!.values()].map(clone);
  }

  row(table: string, id: string): Row | undefined {
    const r = this.committed.get(table)!.get(id);
    return r ? clone(r) : undefined;
  }

  // ── khoá ────────────────────────────────────────────────────────────────
  private async acquire(tx: Tx, key: string): Promise<void> {
    for (;;) {
      const lock = this.locks.get(key);
      if (!lock || lock.owner === null || lock.owner === tx) {
        this.locks.set(key, { owner: tx, queue: lock?.queue ?? [] });
        tx.held.add(key);
        return;
      }
      this.stats.lockWaits += 1;
      await new Promise<void>((resolve) => lock.queue.push(resolve));
    }
  }

  private release(tx: Tx): void {
    for (const key of tx.held) {
      const lock = this.locks.get(key);
      if (!lock) continue;
      lock.owner = null;
      lock.queue.shift()?.();
    }
    tx.held.clear();
  }

  private commit(tx: Tx): void {
    for (const [table, rows] of tx.overlay) {
      const target = this.committed.get(table)!;
      for (const [id, row] of rows) {
        if (row === null) target.delete(id);
        else target.set(id, row);
      }
    }
    this.stats.commits += 1;
    this.release(tx);
  }

  private rollback(tx: Tx): void {
    this.stats.rollbacks += 1;
    this.release(tx);
  }

  // ── đọc ─────────────────────────────────────────────────────────────────
  private live(tx: Tx): void {
    if (tx.aborted) {
      throw Object.assign(new Error('current transaction is aborted, commands ignored until end of transaction block'), { code: '25P02' });
    }
  }

  private latest(tx: Tx, table: string, id: string): Row | undefined {
    const o = tx.overlay.get(table);
    if (o?.has(id)) return o.get(id) ?? undefined;
    return this.committed.get(table)!.get(id);
  }

  private visible(tx: Tx, table: string): Row[] {
    const out = new Map<string, Row>();
    for (const [id, r] of this.committed.get(table)!) out.set(id, r);
    for (const [id, r] of tx.overlay.get(table) ?? []) {
      if (r === null) out.delete(id);
      else out.set(id, r);
    }
    return [...out.values()];
  }

  private matches(tx: Tx, table: string, row: Row, where: Record<string, any> | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') {
        if (!asArray(cond).every((w: any) => this.matches(tx, table, row, w))) return false;
      } else if (key === 'OR') {
        if (!asArray(cond).some((w: any) => this.matches(tx, table, row, w))) return false;
      } else if (key === 'NOT') {
        if (asArray(cond).some((w: any) => this.matches(tx, table, row, w))) return false;
      } else if (this.specs[table]?.relations?.[key] && isPlain(cond)) {
        const rel = this.specs[table]!.relations![key]!;
        const related = row[rel.fk] == null ? undefined : this.latest(tx, rel.table, row[rel.fk]);
        if (!related || !this.matches(tx, rel.table, related, cond)) return false;
      } else if (!scalarMatches(row[key], cond)) return false;
    }
    return true;
  }

  /** `where` của findUnique: gộp khoá ghép ({ userId_type_refId: {...} }) thành các điều kiện phẳng. */
  private flatten(where: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(where)) {
      if (k.includes('_') && isPlain(v) && !('equals' in v) && !('in' in v) && !('not' in v)) Object.assign(out, v);
      else out[k] = v;
    }
    return out;
  }

  private shape(tx: Tx, table: string, row: Row, args: Record<string, any> | undefined): Row {
    const out = clone(row);
    for (const [name, on] of Object.entries(args?.include ?? {})) {
      const rel = this.specs[table]?.relations?.[name];
      if (on && rel) out[name] = row[rel.fk] == null ? null : clone(this.latest(tx, rel.table, row[rel.fk]) ?? null);
    }
    return out;
  }

  private sorted(rows: Row[], orderBy: any): Row[] {
    const keys = asArray(orderBy ?? []).flatMap((o: any) => Object.entries(o) as [string, 'asc' | 'desc'][]);
    if (keys.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const [k, dir] of keys) {
        const d = a[k] == null || b[k] == null ? 0 : cmp(a[k], b[k]) || (typeof a[k] === 'string' ? (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) : 0);
        if (d !== 0) return dir === 'desc' ? -d : d;
      }
      return 0;
    });
  }

  // ── ghi ─────────────────────────────────────────────────────────────────
  private write(tx: Tx, table: string, row: Row): void {
    if (!tx.overlay.has(table)) tx.overlay.set(table, new Map());
    tx.overlay.get(table)!.set(row.id, row);
  }

  private applyData(row: Row, data: Record<string, any>): Row {
    const next = clone(row);
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (isPlain(v) && ('increment' in v || 'decrement' in v)) next[k] = (next[k] ?? 0) + (v.increment ?? 0) - (v.decrement ?? 0);
      else next[k] = clone(v);
    }
    return next;
  }

  private uniqueViolation(table: string, u: UniqueSpec): Error {
    return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${u.fields.join(',')}) of ${table}`, {
      code: 'P2002',
      clientVersion: 'race-db',
      meta: { target: u.fields },
    });
  }

  /** Trả true nếu đã chèn. `skipDuplicates` = ON CONFLICT DO NOTHING; ngược lại trùng → P2002 và transaction aborted. */
  private async insert(tx: Tx, table: string, data: Row, skipDuplicates: boolean): Promise<Row | null> {
    const row: Row = { ...clone(this.specs[table]?.defaults ?? {}), ...clone(data), id: data.id ?? `${table}-${++this.seq}` };
    for (const u of this.specs[table]?.unique ?? []) {
      if (u.when && !u.when(row)) continue;
      const vals = u.fields.map((f) => row[f]);
      if (vals.some((v) => v === null || v === undefined)) continue;
      await this.acquire(tx, `uq:${table}:${u.fields.join('+')}:${vals.map((v) => (v instanceof Date ? v.toISOString() : String(v))).join('|')}`);
      const dup = this.visible(tx, table).some((r) => (!u.when || u.when(r)) && u.fields.every((f) => same(r[f], row[f])));
      if (dup) {
        if (skipDuplicates) return null;
        tx.aborted = true;
        throw this.uniqueViolation(table, u);
      }
    }
    this.write(tx, table, row);
    return row;
  }

  private async changeRows(tx: Tx, table: string, where: Record<string, any>, data: Record<string, any>, only?: 'first'): Promise<Row[]> {
    const candidates = this.visible(tx, table).filter((r) => this.matches(tx, table, r, where));
    const changed: Row[] = [];
    for (const c of candidates) {
      await this.acquire(tx, `row:${table}:${c.id}`);
      const cur = this.latest(tx, table, c.id);
      if (!cur || !this.matches(tx, table, cur, where)) continue;
      const next = this.applyData(cur, data);
      for (const u of this.specs[table]?.unique ?? []) {
        if (u.when && !u.when(next)) continue;
        if (u.fields.every((f) => same(next[f], cur[f])) && (!u.when || u.when(cur))) continue;
        const vals = u.fields.map((f) => next[f]);
        if (vals.some((v) => v == null)) continue;
        await this.acquire(tx, `uq:${table}:${u.fields.join('+')}:${vals.map(String).join('|')}`);
        if (this.visible(tx, table).some((r) => r.id !== next.id && (!u.when || u.when(r)) && u.fields.every((f) => same(r[f], next[f])))) {
          tx.aborted = true;
          throw this.uniqueViolation(table, u);
        }
      }
      this.write(tx, table, next);
      changed.push(next);
      if (only === 'first') break;
    }
    return changed;
  }

  // ── client ──────────────────────────────────────────────────────────────
  /** Chạy một câu: transaction thật dùng tx của nó; autocommit thì mỗi câu một tx ngắn (khoá nhả ngay khi xong câu). */
  private async stmt<T>(tx: Tx | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (tx) {
      this.live(tx);
      await tick();
      this.live(tx);
      return fn(tx);
    }
    const own = new Tx(true);
    await tick();
    try {
      const result = await fn(own);
      this.commit(own);
      return result;
    } catch (err) {
      this.rollback(own);
      throw err;
    }
  }

  private buildModel(table: string, ctx: Tx | null) {
    const find = (args: any, unique: boolean) =>
      this.stmt(ctx, async (tx) => {
        const where = unique ? this.flatten(args?.where ?? {}) : args?.where;
        let rows = this.visible(tx, table).filter((r) => this.matches(tx, table, r, where));
        rows = this.sorted(rows, args?.orderBy);
        if (typeof args?.take === 'number') rows = rows.slice(0, args.take);
        return rows.map((r) => this.shape(tx, table, r, args));
      });
    const notFound = (what: string) => Object.assign(new Error(`No ${what} found`), { code: 'P2025' });
    return {
      findMany: (args?: any) => find(args, false),
      findFirst: async (args?: any) => (await find({ ...args, take: 1 }, false))[0] ?? null,
      findFirstOrThrow: async (args?: any) => {
        const r = (await find({ ...args, take: 1 }, false))[0];
        if (!r) throw notFound(table);
        return r;
      },
      findUnique: async (args: any) => (await find({ ...args, take: 1 }, true))[0] ?? null,
      findUniqueOrThrow: async (args: any) => {
        const r = (await find({ ...args, take: 1 }, true))[0];
        if (!r) throw notFound(table);
        return r;
      },
      count: async (args?: any) => (await find({ where: args?.where }, false)).length,
      aggregate: async (args: any) => {
        const rows = await find({ where: args.where }, false);
        const sum: Record<string, number | null> = {};
        for (const f of Object.keys(args._sum ?? {})) sum[f] = rows.length ? rows.reduce((s, r) => s + (r[f] ?? 0), 0) : null;
        return { _sum: sum, _count: { _all: rows.length } };
      },
      create: (args: any) =>
        this.stmt(ctx, async (tx) => {
          const row = await this.insert(tx, table, args.data, false);
          return this.shape(tx, table, row!, args);
        }),
      createMany: (args: any) =>
        this.stmt(ctx, async (tx) => {
          let count = 0;
          for (const d of asArray(args.data)) if (await this.insert(tx, table, d, args.skipDuplicates === true)) count += 1;
          return { count };
        }),
      update: (args: any) =>
        this.stmt(ctx, async (tx) => {
          const [row] = await this.changeRows(tx, table, this.flatten(args.where), args.data, 'first');
          if (!row) throw notFound(table);
          return this.shape(tx, table, row, args);
        }),
      updateMany: (args: any) => this.stmt(ctx, async (tx) => ({ count: (await this.changeRows(tx, table, args.where ?? {}, args.data)).length })),
      delete: (args: any) =>
        this.stmt(ctx, async (tx) => {
          const row = this.visible(tx, table).find((r) => this.matches(tx, table, r, this.flatten(args.where)));
          if (!row) throw notFound(table);
          await this.acquire(tx, `row:${table}:${row.id}`);
          if (!tx.overlay.has(table)) tx.overlay.set(table, new Map());
          tx.overlay.get(table)!.set(row.id, null);
          return clone(row);
        }),
    };
  }

  private async raw(ctx: Tx | null, strings: TemplateStringsArray, values: unknown[]): Promise<unknown> {
    return this.stmt(ctx, async (tx) => {
      const sql = strings.join('?');
      const params = values.flatMap((v) => (isPlain(v) && Array.isArray((v as any).values) ? (v as any).values : [v]));
      const handler = this.handlers.find((h) => h.match.test(sql));
      if (!handler) throw new Error(`race-db: chưa có handler cho SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
      return handler.run({
        sql,
        params,
        locking: /FOR (NO KEY )?UPDATE/.test(sql),
        db: this,
        lockRow: (table, id) => this.acquire(tx, `row:${table}:${id}`),
        lockKey: (key) => this.acquire(tx, `key:${key}`),
        rows: (table) => this.visible(tx, table).map(clone),
        client: this.buildClient(tx),
      });
    });
  }

  private buildClient(ctx: Tx | null): any {
    const client: Record<string, unknown> = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => this.raw(ctx, strings, values),
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => this.raw(ctx, strings, values),
    };
    for (const table of Object.keys(this.specs)) client[table] = this.buildModel(table, ctx);
    if (ctx === null) {
      client.$transaction = async (arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        const tx = new Tx(false);
        try {
          const result = await (arg as (c: unknown) => Promise<unknown>)(this.buildClient(tx));
          this.commit(tx);
          return result;
        } catch (err) {
          this.rollback(tx);
          throw err;
        }
      };
    }
    return client;
  }
}
