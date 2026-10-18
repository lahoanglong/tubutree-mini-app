import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_PARTIAL_UNIQUE_INDEXES, partialUniqueIndexesFromSql } from '../../../prisma/check-partial-indexes';

const SQL = readFileSync(join(__dirname, '../../../prisma/migrations/20261020000000_waste_exchange/migration.sql'), 'utf-8');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function section(name: string): string {
  const a = SQL.indexOf(`-- BEGIN ${name}`);
  const b = SQL.indexOf(`-- END ${name}`);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return SQL.slice(a, b);
}
const withoutComments = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const INDEXES: [string, string][] = [
  ['points_transactions_recycle_ref_key', `CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_recycle_ref_key" ON "points_transactions" ("refId") WHERE "refType" = 'RECYCLE';`],
  ['points_transactions_recycle_reverse_key', `CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_recycle_reverse_key" ON "points_transactions" ("refId") WHERE "refType" = 'RECYCLE_REVERSED';`],
  ['points_transactions_gift_refund_key', `CREATE UNIQUE INDEX IF NOT EXISTS "points_transactions_gift_refund_key" ON "points_transactions" ("refId") WHERE "refType" = 'GIFT_REFUND';`],
  ['waste_points_one_warehouse_key', `CREATE UNIQUE INDEX IF NOT EXISTS "waste_points_one_warehouse_key" ON "waste_points" ("kind") WHERE "kind" = 'WAREHOUSE';`],
  ['waste_point_staff_one_owner_key', `CREATE UNIQUE INDEX IF NOT EXISTS "waste_point_staff_one_owner_key" ON "waste_point_staff" ("pointId") WHERE "role" = 'OWNER' AND "isActive";`],
];

const CHECKS: [name: string, table: string, expr: string][] = [
  ['waste_items_hazardous_not_active_chk', 'waste_items', `NOT ("hazardous" AND "status" = 'ACTIVE')`],
  ['waste_items_units_per_point_chk', 'waste_items', `"unitsPerPoint" >= 1`],
  ['waste_items_points_per_group_chk', 'waste_items', `"pointsPerGroup" >= 1`],
  ['waste_items_drops_chk', 'waste_items', `"dropsPerUnit" >= 0`],
  ['waste_items_daily_cap_chk', 'waste_items', `"dailyCapQty" IS NULL OR "dailyCapQty" >= 1`],
  ['waste_items_monthly_cap_chk', 'waste_items', `"monthlyCapQty" IS NULL OR "monthlyCapQty" >= 1`],
  ['waste_points_partner_quota_chk', 'waste_points', `"kind" = 'WAREHOUSE' OR "monthlyQuotaPoints" IS NOT NULL`],
  ['waste_points_warehouse_active_chk', 'waste_points', `"kind" <> 'WAREHOUSE' OR "status" = 'ACTIVE'`],
  [
    'waste_requests_expires_at_chk',
    'waste_requests',
    `NOT ("status" = 'OPEN' AND "orderId" IS NOT NULL AND "expiresAt" IS NOT NULL) AND ("method" <> 'MAIL_IN' OR "status" <> 'IN_TRANSIT' OR "expiresAt" IS NULL) AND ("method" <> 'PICKUP' OR "status" <> 'IN_TRANSIT' OR "expiresAt" IS NOT NULL)`,
  ],
  ['waste_request_lines_received_chk', 'waste_request_lines', `"receivedQty" IS NULL OR ("receivedQty" >= 0 AND "receivedQty" <= "declaredQty")`],
  ['waste_request_lines_declared_chk', 'waste_request_lines', `"declaredQty" >= 1`],
  ['waste_point_usage_points_chk', 'waste_point_usage', `"pointsUsed" >= 0`],
  ['waste_gifts_stock_chk', 'waste_gifts', `"stock" IS NULL OR "stock" >= 0`],
  [
    'waste_gifts_voucher_fields_chk',
    'waste_gifts',
    `"kind" <> 'VOUCHER' OR ("voucherType" IS NOT NULL AND "voucherValue" IS NOT NULL AND "voucherValidDays" IS NOT NULL)`,
  ],
  ['waste_gifts_points_cost_chk', 'waste_gifts', `"kind" = 'TREE' OR "pointsCost" BETWEEN 1 AND 2000000`],
  ['waste_gift_redemptions_ready_chk', 'waste_gift_redemptions', `"status" <> 'READY' OR ("code" IS NOT NULL AND "giftKind" IN ('SEED_PACK', 'GIFT'))`],
];

describe('waste migration, hand-written constraints section', () => {
  const hand = section('WASTE HAND-WRITTEN CONSTRAINTS');

  it.each(INDEXES)('%s is one top-level statement of the pinned form', (_name, statement) => {
    expect(squash(withoutComments(hand))).toContain(statement);
  });

  it('the index statements contain no semicolon or comment marker inside and are found by the checker parser', () => {
    const statements = withoutComments(hand).split(';').map((s) => s.trim()).filter((s) => s.startsWith('CREATE UNIQUE INDEX'));
    expect(statements).toHaveLength(5);
    for (const s of statements) expect(s).not.toContain('--');
    const found = partialUniqueIndexesFromSql([SQL]);
    for (const [name] of INDEXES) expect(found).toContain(name);
  });

  it.each(CHECKS)('%s sits in its own re-runnable DO block', (name, table, expr) => {
    expect(squash(hand)).toContain(
      `DO $$ BEGIN ALTER TABLE "${table}" ADD CONSTRAINT "${name}" CHECK (${expr}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
  });

  it('has exactly sixteen DO blocks and no other statements besides the five indexes', () => {
    expect(hand.match(/^DO \$\$/gm)).toHaveLength(16);
    expect(hand.match(/EXCEPTION WHEN duplicate_object THEN NULL;/g)).toHaveLength(16);
    const rest = withoutComments(hand).replace(/DO \$\$[\s\S]*?END \$\$;/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    expect(rest).toHaveLength(5);
    for (const s of rest) expect(s).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS "/);
  });
});

describe('KNOWN_PARTIAL_UNIQUE_INDEXES', () => {
  it('has 23 sorted entries including the three new points_transactions keys', () => {
    expect(KNOWN_PARTIAL_UNIQUE_INDEXES).toHaveLength(23);
    expect([...KNOWN_PARTIAL_UNIQUE_INDEXES]).toEqual([...KNOWN_PARTIAL_UNIQUE_INDEXES].sort());
    for (const n of ['points_transactions_recycle_ref_key', 'points_transactions_recycle_reverse_key', 'points_transactions_gift_refund_key']) {
      expect(KNOWN_PARTIAL_UNIQUE_INDEXES).toContain(n);
    }
  });
});
