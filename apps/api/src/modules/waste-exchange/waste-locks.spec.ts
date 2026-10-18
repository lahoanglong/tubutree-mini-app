import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Prisma } from '@prisma/client';
import { lockWasteCustomer, lockWastePointCreate, lockWasteStaffCap, lockWasteTracking } from './waste-locks';
import { WASTE_LOCK_CLASS } from './waste.constants';

const fakeTx = () => {
  const $executeRaw = jest.fn().mockResolvedValue(1);
  const $queryRaw = jest.fn().mockResolvedValue([]);
  const $executeRawUnsafe = jest.fn().mockResolvedValue(1);
  const $queryRawUnsafe = jest.fn().mockResolvedValue([]);
  return {
    tx: { $executeRaw, $queryRaw, $executeRawUnsafe, $queryRawUnsafe } as unknown as Prisma.TransactionClient,
    calls: $executeRaw.mock.calls as [TemplateStringsArray, ...unknown[]][],
    others: [$queryRaw, $executeRawUnsafe, $queryRawUnsafe],
  };
};
const sqlOf = (call: [TemplateStringsArray, ...unknown[]]) => call[0].join('?');

describe('waste advisory locks write the class literal inside the SQL text, through tx.$executeRaw', () => {
  it.each([
    ['lockWasteCustomer', (tx: Prisma.TransactionClient) => lockWasteCustomer(tx, 'user-1'), 'SELECT pg_advisory_xact_lock(731001, hashtext(?))', ['user-1']],
    ['lockWasteTracking', (tx: Prisma.TransactionClient) => lockWasteTracking(tx), 'SELECT pg_advisory_xact_lock(731002, 0)', []],
    ['lockWasteStaffCap', (tx: Prisma.TransactionClient) => lockWasteStaffCap(tx, 'staff-1'), 'SELECT pg_advisory_xact_lock(731003, hashtext(?))', ['staff-1']],
    ['lockWastePointCreate', (tx: Prisma.TransactionClient) => lockWastePointCreate(tx), 'SELECT pg_advisory_xact_lock(731004, 0)', []],
  ])('%s', async (_name, run, sql, params) => {
    const { tx, calls, others } = fakeTx();
    await expect(run(tx)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(sqlOf(calls[0]!)).toBe(sql);
    expect(calls[0]!.slice(1)).toEqual(params);
    for (const other of others) expect(other).not.toHaveBeenCalled();
  });

  it('the literals equal WASTE_LOCK_CLASS', () => {
    expect(Object.values(WASTE_LOCK_CLASS)).toEqual([731001, 731002, 731003, 731004]);
  });

  const WX = __dirname;
  const SRC = join(__dirname, '../..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('gate for later lanes: every advisory lock in this module has a waste class literal or a cron key, never a bound class', () => {
    const offenders: string[] = [];
    for (const file of walk(WX)) {
      for (const m of strip(readFileSync(file, 'utf-8')).matchAll(/pg_(?:try_)?advisory_xact_lock\(\s*([^)]*)/g)) {
        const first = m[1]!.trim();
        if (!/^73100[1-4]\s*,/.test(first) && !/^hashtext\('cron:/.test(first)) offenders.push(`${relative(WX, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gate for later lanes: a blocking advisory lock is never sent through $queryRaw (void result; only pg_try_advisory_xact_lock may use it)', () => {
    const offenders: string[] = [];
    for (const file of walk(WX)) {
      for (const m of strip(readFileSync(file, 'utf-8')).matchAll(/\$queryRaw(?:Unsafe)?\s*(?:<[^>]*>)?\s*[`(][^`]*?pg_advisory_xact_lock\(/g)) {
        offenders.push(`${relative(WX, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file outside this module uses the four class numbers', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.startsWith(WX))
      .filter((f) => /\b73100[1-4]\b/.test(strip(readFileSync(f, 'utf-8'))))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
