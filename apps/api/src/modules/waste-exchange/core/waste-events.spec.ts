import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { WasteEventsService, deviceMetaOf, truncateIp, writeWasteEvent } from './waste-events';

const fakeDb = () => {
  const create = jest.fn().mockResolvedValue({ id: 'ev-1' });
  return { db: { wasteEvent: { create } } as unknown as Prisma.TransactionClient, create };
};

describe('writeWasteEvent', () => {
  it('writes one row, absent ids become null, returns the id', async () => {
    const { db, create } = fakeDb();
    await expect(writeWasteEvent(db, { kind: 'REQUEST_CREATED', actorUserId: 'u1', actorRole: 'CUSTOMER', requestId: 'r1', meta: { lines: [{ itemId: 'i1', declaredQty: 3 }] } })).resolves.toEqual({ id: 'ev-1' });
    expect(create).toHaveBeenCalledWith({
      data: { kind: 'REQUEST_CREATED', actorUserId: 'u1', actorRole: 'CUSTOMER', requestId: 'r1', pointId: null, giftRedemptionId: null, meta: { lines: [{ itemId: 'i1', declaredQty: 3 }] } },
      select: { id: true },
    });
  });
  it('leaves meta out when absent', async () => {
    const { db, create } = fakeDb();
    await writeWasteEvent(db, { kind: 'SHIP_LOCKED', actorUserId: null, actorRole: 'SYSTEM' });
    expect(create.mock.calls[0]![0].data).toEqual({ kind: 'SHIP_LOCKED', actorUserId: null, actorRole: 'SYSTEM', requestId: null, pointId: null, giftRedemptionId: null });
  });
  it('rejects a kind outside WASTE_EVENT_KINDS and writes nothing', async () => {
    const { db, create } = fakeDb();
    await expect(writeWasteEvent(db, { kind: 'NOPE' as never, actorUserId: null, actorRole: 'SYSTEM' })).rejects.toThrow('Unknown waste event kind: NOPE');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('truncateIp (spec 5.5: IPv4 drops the last octet, IPv6 keeps 48 bits)', () => {
  it.each([
    ['203.0.113.42', '203.0.113.0'],
    ['::ffff:203.0.113.42', '203.0.113.0'],
    ['2001:0db8:85a3:0000:0000:8a2e:0370:7334', '2001:db8:85a3::'],
    ['2001:db8::1', '2001:db8:0::'],
    ['garbage', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%p -> %p', (ip, expected) => expect(truncateIp(ip)).toBe(expected));
});

describe('deviceMetaOf', () => {
  it('truncates the IP and keeps the first 200 characters of the user agent', () => {
    expect(deviceMetaOf({ ip: '203.0.113.42', headers: { 'user-agent': 'x'.repeat(250) } })).toEqual({ ip: '203.0.113.0', userAgent: 'x'.repeat(200) });
  });
  it('takes the first user-agent value of a repeated header; nulls when absent', () => {
    expect(deviceMetaOf({ ip: undefined, headers: { 'user-agent': ['A', 'B'] } })).toEqual({ ip: null, userAgent: 'A' });
    expect(deviceMetaOf({ headers: {} })).toEqual({ ip: null, userAgent: null });
  });
});

describe('WasteEventsService.record', () => {
  it('writes through the passed tx, else through PrismaService', async () => {
    const own = fakeDb();
    const tx = fakeDb();
    const svc = new WasteEventsService(own.db as unknown as PrismaService);
    await svc.record({ kind: 'LOOKUP_MISS', actorUserId: 's1', actorRole: 'POINT_STAFF', pointId: 'p1' });
    await svc.record({ kind: 'LOOKUP_MISS', actorUserId: 's1', actorRole: 'POINT_STAFF', pointId: 'p1' }, tx.db);
    expect(own.create).toHaveBeenCalledTimes(1);
    expect(tx.create).toHaveBeenCalledTimes(1);
  });
});

describe('waste_events is append-only (spec 11.1)', () => {
  const SRC = join(__dirname, '../../..');
  const PRISMA_WRITE = /\.wasteEvent\.(update|updateMany|upsert|delete|deleteMany)\(/;
  const SQL_WRITE = /(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+"?waste_events"?\b/i;
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
    }
    return out;
  };
  it('the SQL pattern catches update, delete and truncate but not insert', () => {
    for (const s of ['DELETE FROM waste_events', 'UPDATE "waste_events" SET', 'TRUNCATE waste_events']) expect(s).toMatch(SQL_WRITE);
    expect('INSERT INTO "waste_events"').not.toMatch(SQL_WRITE);
  });
  it('no application file under apps/api/src updates or deletes a waste_events row', () => {
    const offenders = walk(SRC).filter((f) => {
      const s = readFileSync(f, 'utf-8');
      return PRISMA_WRITE.test(s) || SQL_WRITE.test(s);
    });
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
