import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PRISMA_DIR = join(__dirname, '../../../prisma');
const FOLDER = '20261020000000_waste_exchange';
const SCHEMA = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf-8');
const SQL = readFileSync(join(PRISMA_DIR, 'migrations', FOLDER, 'migration.sql'), 'utf-8');

const ENUMS: Record<string, string[]> = {
  WasteItemStatus: ['ACTIVE', 'COMING_SOON', 'HIDDEN'],
  WastePointKind: ['WAREHOUSE', 'PARTNER'],
  WastePointStatus: ['ACTIVE', 'PAUSED', 'PENDING'],
  WastePointStaffRole: ['OWNER', 'STAFF'],
  WasteMethod: ['DROP_OFF', 'MAIL_IN', 'PICKUP'],
  WasteRequestStatus: ['OPEN', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVERSED'],
  WasteCloseReason: ['HOLD_EXPIRED', 'PICKUP_NO_SHOW', 'PICKUP_NOT_DISPATCHED', 'LOST', 'LOST_AT_WAREHOUSE', 'SHIP_LOCKED', 'ORDER_CANCELLED'],
  WasteRejectionReason: ['WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OVERSIZE', 'HAZARDOUS', 'UNPAID_POSTAGE', 'OTHER'],
  WasteShortfallReason: ['WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OTHER'],
  WasteActorRole: ['CUSTOMER', 'POINT_STAFF', 'STAFF', 'ADMIN', 'SYSTEM'],
  WasteUnmatchedStatus: ['OPEN', 'RESOLVED'],
  WasteGiftKind: ['VOUCHER', 'TREE', 'SEED_PACK', 'GIFT'],
  WasteGiftStatus: ['ACTIVE', 'HIDDEN'],
  WasteGiftRedemptionStatus: ['READY', 'FULFILLED', 'CANCELLED'],
};

const MODELS: Record<string, string> = {
  WasteItem: 'waste_items',
  WastePoint: 'waste_points',
  WastePointItem: 'waste_point_items',
  WastePointStaff: 'waste_point_staff',
  WastePointUsage: 'waste_point_usage',
  WasteRequest: 'waste_requests',
  WasteRequestLine: 'waste_request_lines',
  WasteEvent: 'waste_events',
  WasteUnmatchedParcel: 'waste_unmatched_parcels',
  WasteUserFlags: 'waste_user_flags',
  WasteGift: 'waste_gifts',
  WasteGiftRedemption: 'waste_gift_redemptions',
};

function block(kind: 'model' | 'enum', name: string): string {
  const m = new RegExp(`^${kind} ${name} \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(SCHEMA);
  if (!m) throw new Error(`${kind} ${name} not found in schema.prisma`);
  return m[1]!;
}
const enumValues = (name: string) =>
  block('enum', name).split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));

describe('waste schema (schema.prisma)', () => {
  it.each(Object.entries(ENUMS))('enum %s has exactly these values in this order', (name, values) => {
    expect(enumValues(name)).toEqual(values);
  });

  it.each(Object.entries(MODELS))('model %s maps to table %s', (model, table) => {
    expect(block('model', model)).toContain(`@@map("${table}")`);
  });

  it('keys: WasteGift id has no default, composite and one-column primary keys are as in the contract', () => {
    expect(block('model', 'WasteGift')).toMatch(/^\s*id\s+String\s+@id\s*$/m);
    expect(block('model', 'WastePointItem')).toContain('@@id([pointId, itemId])');
    expect(block('model', 'WastePointUsage')).toContain('@@id([pointId, monthKey])');
    expect(block('model', 'WasteUserFlags')).toMatch(/^\s*userId\s+String\s+@id/m);
    for (const m of ['WasteItem', 'WastePoint', 'WastePointStaff', 'WasteRequest', 'WasteRequestLine', 'WasteEvent', 'WasteUnmatchedParcel', 'WasteGiftRedemption']) {
      expect(block('model', m)).toMatch(/^\s*id\s+String\s+@id @default\(cuid\(\)\)/m);
    }
  });

  const ON_DELETE: [string, string, string][] = [
    ['WastePointItem', 'point', 'Cascade'],
    ['WastePointItem', 'item', 'Restrict'],
    ['WastePointStaff', 'point', 'Cascade'],
    ['WastePointStaff', 'user', 'Restrict'],
    ['WastePointUsage', 'point', 'Cascade'],
    ['WasteRequest', 'user', 'Restrict'],
    ['WasteRequest', 'point', 'Restrict'],
    ['WasteRequest', 'order', 'Restrict'],
    ['WasteRequestLine', 'request', 'Cascade'],
    ['WasteRequestLine', 'item', 'Restrict'],
    ['WasteUserFlags', 'user', 'Restrict'],
    ['WasteGiftRedemption', 'user', 'Restrict'],
    ['WasteGiftRedemption', 'gift', 'Restrict'],
  ];
  it.each(ON_DELETE)('%s.%s relation has onDelete %s', (model, field, rule) => {
    const re = new RegExp(`^\\s*${field}\\s+\\w+\\??\\s+@relation\\([^)]*onDelete: ${rule}[^)]*\\)`, 'm');
    expect(block('model', model)).toMatch(re);
  });

  it('WasteEvent and WasteUnmatchedParcel have no relations at all (no foreign keys)', () => {
    expect(block('model', 'WasteEvent')).not.toContain('@relation');
    expect(block('model', 'WasteUnmatchedParcel')).not.toContain('@relation');
    expect(block('model', 'WasteGiftRedemption')).not.toMatch(/couponId\s+String\?\s+@relation/);
  });

  const DECLARATIONS: [string, RegExp[]][] = [
    ['WasteItem', [/\bcode\s+String\s+@unique/, /@@index\(\[status, sortOrder\]\)/, /hazardous\s+Boolean\s+@default\(false\)/, /warehouseOnly\s+Boolean\s+@default\(false\)/, /status\s+WasteItemStatus\s+@default\(HIDDEN\)/]],
    ['WastePoint', [/openingHours\s+Json\s+@default\("\{\}"\)/, /status\s+WastePointStatus\s+@default\(PENDING\)/, /giftHandoverEnabled\s+Boolean\s+@default\(false\)/]],
    ['WastePointStaff', [/@@unique\(\[pointId, userId\]\)/]],
    ['WasteRequest', [
      /\bcode\s+String\s+@unique/,
      /orderId\s+String\?\s+@unique/,
      /rejectionNote\s+String\?\s+@db\.VarChar\(500\)/,
      /trackingConflict\s+Boolean\s+@default\(false\)/,
      /@@unique\(\[userId, idempotencyKey\]\)/,
      /@@index\(\[trackingNorm\]\)/,
      /@@index\(\[userId, status\]\)/,
      /@@index\(\[status, method\]\)/,
      /@@index\(\[capMonthKey\]\)/,
      /@@index\(\[confirmedByUserId, completedAt\]\)/,
    ]],
    ['WasteRequestLine', [/@@unique\(\[requestId, itemId\]\)/]],
    ['WasteEvent', [/kind\s+String\b/, /@@index\(\[requestId, createdAt\]\)/, /@@index\(\[pointId, kind, createdAt\]\)/, /@@index\(\[actorUserId, kind, createdAt\]\)/]],
    ['WasteUnmatchedParcel', [/description\s+String\s+@db\.VarChar\(200\)/, /reason\s+String\b/]],
    ['WasteGift', [/voucherType\s+CouponType\?/, /status\s+WasteGiftStatus\s+@default\(HIDDEN\)/]],
    ['WasteGiftRedemption', [/code\s+String\?\s+@unique/, /@@unique\(\[userId, idempotencyKey\]\)/, /@@index\(\[status, claimExpiresAt\]\)/]],
  ];
  it.each(DECLARATIONS)('%s declares its columns, uniques and indexes', (model, patterns) => {
    for (const p of patterns) expect(block('model', model)).toMatch(p);
  });

  // Every column of contract section 2: schema.prisma is frozen after M1, so a missing column would need a new migration.
  const COLUMNS: Record<string, string[]> = {
    WasteItem: ['id', 'code', 'name', 'unitLabel', 'unitsPerPoint', 'pointsPerGroup', 'dropsPerUnit', 'dailyCapQty', 'monthlyCapQty', 'status', 'prepInstructions', 'imageUrl', 'sortOrder', 'gramsPerUnit', 'hazardous', 'warehouseOnly', 'createdAt', 'updatedAt'],
    WastePoint: ['id', 'kind', 'name', 'addressLine', 'provinceCode', 'provinceName', 'communeCode', 'communeName', 'lat', 'lng', 'phone', 'openingHours', 'status', 'monthlyQuotaPoints', 'perkText', 'perkPendingText', 'giftHandoverEnabled', 'note', 'sortOrder', 'activatedAt', 'lastConfirmedAt', 'createdAt', 'updatedAt'],
    WastePointItem: ['pointId', 'itemId'],
    WastePointStaff: ['id', 'pointId', 'userId', 'role', 'isActive', 'createdAt', 'updatedAt'],
    WastePointUsage: ['pointId', 'monthKey', 'pointsUsed', 'confirmations'],
    WasteRequest: ['id', 'code', 'userId', 'method', 'status', 'pointId', 'orderId', 'carrier', 'trackingCode', 'trackingNorm', 'trackingConflict', 'estimatedPoints', 'estimatedDrops', 'capDayKey', 'capMonthKey', 'expiresAt', 'inTransitAt', 'receivedAt', 'completedAt', 'closedAt', 'closeReason', 'confirmedByUserId', 'pointsAwarded', 'dropsAwarded', 'receivedWeightGrams', 'carrierCostVnd', 'rejectionReason', 'rejectionNote', 'reversedAt', 'reversedByUserId', 'reversalReason', 'reversalShortfallPoints', 'idempotencyKey', 'consentAt', 'consentVersion', 'createdAt', 'updatedAt'],
    WasteRequestLine: ['id', 'requestId', 'itemId', 'itemCode', 'itemName', 'unitLabel', 'unitsPerPoint', 'pointsPerGroup', 'dropsPerUnit', 'gramsPerUnit', 'declaredQty', 'receivedQty', 'shortfallReason', 'pointsAwarded'],
    WasteEvent: ['id', 'createdAt', 'kind', 'requestId', 'pointId', 'giftRedemptionId', 'actorUserId', 'actorRole', 'meta'],
    WasteUnmatchedParcel: ['id', 'receivedAt', 'createdByUserId', 'carrier', 'trackingCode', 'trackingNorm', 'description', 'reason', 'relatedRequestId', 'status', 'matchedRequestId', 'resolvedByUserId', 'resolvedAt', 'resolveNote'],
    WasteUserFlags: ['userId', 'shipLockedAt', 'shipUnlockedAt', 'blockedAt', 'reason', 'setByUserId', 'updatedAt'],
    WasteGift: ['id', 'kind', 'name', 'description', 'label', 'pointsCost', 'status', 'sortOrder', 'imageUrl', 'stock', 'claimInstructions', 'voucherType', 'voucherValue', 'voucherMinOrder', 'voucherMaxDiscount', 'voucherValidDays', 'createdAt', 'updatedAt'],
    WasteGiftRedemption: ['id', 'userId', 'giftId', 'giftKind', 'giftName', 'pointsCost', 'status', 'code', 'couponId', 'idempotencyKey', 'claimExpiresAt', 'fulfilledAt', 'fulfilledByUserId', 'fulfilledPointId', 'cancelledAt', 'cancelledByUserId', 'cancelReason', 'refundedPoints', 'createdAt'],
  };
  it.each(Object.entries(COLUMNS))('%s declares every contract column', (model, cols) => {
    const names = new Set(block('model', model).split('\n').map((l) => l.trim().split(/\s+/)[0]));
    expect(cols.filter((c) => !names.has(c))).toEqual([]);
  });

  it('requests keep only userId and unmatched parcels keep no sender name or phone: no name, phone, address, ID or photo column (spec 14.4)', () => {
    for (const model of ['WasteRequest', 'WasteRequestLine', 'WasteUnmatchedParcel']) {
      const names = block('model', model).split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '');
      expect(names.filter((n) => /name$|phone|address|sender|idCard|identity|photo/i.test(n) && n !== 'itemName')).toEqual([]);
    }
  });

  it('no CO2e factor, no district column, no foreign key on an actor column (spec 5.7, 6, 11.1)', () => {
    const wasteSchema = [...Object.keys(ENUMS).map((e) => block('enum', e)), ...Object.keys(MODELS).map((m) => block('model', m))].join('\n');
    expect(wasteSchema).not.toMatch(/co2|carbon|emission|\bwarm\b/i);
    expect(SQL).not.toMatch(/co2|carbon|emission|\bwarm\b/i);
    const pointColumns = block('model', 'WastePoint').split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '');
    expect(pointColumns.filter((n) => /district/i.test(n))).toEqual([]);
    for (const m of ['WasteRequest', 'WasteGiftRedemption', 'WasteUserFlags']) {
      expect(block('model', m)).not.toMatch(/fields:\s*\[\w*ByUserId\]/);
    }
  });

  it('WastePointUsage has exactly four columns (spec 11.4 inserts only these)', () => {
    const names = block('model', 'WastePointUsage').split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '')
      .filter((n) => n !== '' && !n.startsWith('@') && !n.startsWith('/'));
    expect(names.filter((n) => n !== 'point').sort()).toEqual(['confirmations', 'monthKey', 'pointId', 'pointsUsed']);
  });

  // The non-unique indexes of contract section 2 that DECLARATIONS does not already pin.
  const INDEXES: [string, string][] = [
    ['WastePoint', '@@index([kind, status])'], ['WastePoint', '@@index([provinceCode, status])'], ['WastePointItem', '@@index([itemId])'],
    ['WastePointStaff', '@@index([userId, isActive])'], ['WasteRequest', '@@index([pointId, status])'], ['WasteRequest', '@@index([status, expiresAt])'],
    ['WasteRequestLine', '@@index([itemId])'], ['WasteUnmatchedParcel', '@@index([status, receivedAt])'], ['WasteUnmatchedParcel', '@@index([trackingNorm])'],
    ['WasteGift', '@@index([status, sortOrder])'], ['WasteGiftRedemption', '@@index([userId, createdAt])'],
  ];
  it.each(INDEXES)('%s declares %s', (model, idx) => {
    expect(block('model', model)).toContain(idx);
  });

  it('adds the back-relations to User and Order', () => {
    const user = block('model', 'User');
    expect(user).toMatch(/wasteRequests\s+WasteRequest\[\]/);
    expect(user).toMatch(/wasteGiftRedemptions\s+WasteGiftRedemption\[\]/);
    expect(user).toMatch(/wastePointStaff\s+WastePointStaff\[\]/);
    expect(user).toMatch(/wasteFlags\s+WasteUserFlags\?/);
    expect(block('model', 'Order')).toMatch(/wasteRequest\s+WasteRequest\?/);
  });
});

describe('waste migration folder (generated DDL part)', () => {
  it('sorts after the previous newest migration and its first line is the Vietnamese reason that says Chỉ THÊM (spec 11.7)', () => {
    const dirs = readdirSync(join(PRISMA_DIR, 'migrations')).filter((d) => statSync(join(PRISMA_DIR, 'migrations', d)).isDirectory());
    expect(dirs).toContain(FOLDER);
    expect(FOLDER > '20261018000100_n1_indexes').toBe(true);
    expect(FOLDER > '20261018120000_lr_source_first_touch').toBe(true);
    expect(FOLDER > '20261019120000_merchant_link_prev_rate').toBe(true);
    expect(FOLDER.startsWith('20261020000000_')).toBe(true);
    const header = SQL.split('\n').slice(0, 4).join('\n');
    expect(SQL.startsWith('-- ')).toBe(true);
    expect(SQL.split('\n')[0]).toContain('Chỉ THÊM');
    expect(header).toContain('Chỉ THÊM');
  });

  it('creates the 14 enums and the 12 tables, and nothing else is altered or dropped', () => {
    const types = [...SQL.matchAll(/CREATE TYPE "(Waste\w+)" AS ENUM/g)].map((m) => m[1]!).sort();
    expect(types).toEqual(Object.keys(ENUMS).sort());
    const tables = [...SQL.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!).sort();
    expect(tables).toEqual(Object.values(MODELS).sort());
    const altered = [...SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]!);
    expect(altered.filter((t) => !t.startsWith('waste_'))).toEqual([]);
    expect(SQL).not.toMatch(/\bDROP\b/i);
  });

  it('carries the generated unique indexes and never mentions the legacy expiry key (points-unit-guard)', () => {
    for (const name of ['waste_requests_code_key', 'waste_requests_orderId_key', 'waste_requests_userId_idempotencyKey_key', 'waste_gift_redemptions_code_key', 'waste_gift_redemptions_userId_idempotencyKey_key', 'waste_items_code_key']) {
      expect(SQL).toContain(`CREATE UNIQUE INDEX "${name}"`);
    }
    expect(SQL).not.toContain('loyalty.point_expire_months');
  });
});
