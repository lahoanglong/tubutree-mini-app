import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * W179-A (P1) — Danh sách cho phép tĩnh đối với mọi nơi chạm Điểm Xanh trong `waste-exchange/**` và `integrations/gomdon/**`.
 *
 * Bất biến:
 * 1. Chỉ `receiving/waste-confirm.service.ts` được đúc Điểm Xanh mới (`RECYCLE`) sau khi kho/điểm nhận xác nhận hàng thật,
 *    và chỉ `catalog/waste-gift-redemptions.service.ts` được hoàn điểm quà bị huỷ (`GIFT_REFUND`). Không file nào khác được gọi `.grant(`.
 * 2. Chỉ ba nơi được gọi `applyPointsDelta(`:
 *    - `home-pickup/waste-home-pickup-customer.service.ts`: TRỪ điểm trả phí lấy rác (`WASTE_PICKUP_FEE`, delta < 0).
 *    - `home-pickup/waste-home-pickup-ledger.ts`: HOÀN đúng số điểm phí lấy rác đã trừ (`WASTE_PICKUP_FEE_REFUND`, delta > 0).
 *    - `receiving/waste-reverse.service.ts`: TRỪ thu hồi điểm đã cộng (`RECYCLE_REVERSED`, delta < 0).
 * 3. `integrations/gomdon/**` (tạo vận đơn, đối soát, webhook bưu tá lấy rác 3/4/5/7...) TUYỆT ĐỐI không gọi `.grant(` hay `applyPointsDelta(`.
 */

const MODULES_ROOT = join(__dirname, '..');
const SCANNED_DIRS = [join(MODULES_ROOT, 'waste-exchange'), join(MODULES_ROOT, 'integrations', 'gomdon')];

export interface MintCallHit {
  relPath: string;
  kind: 'grant' | 'applyPointsDelta';
  count: number;
}

const GRANT_ALLOWLIST: Record<string, { count: number; direction: 'MINT_RECYCLE' | 'REFUND_GIFT'; refType: string }> = {
  'waste-exchange/receiving/waste-confirm.service.ts': { count: 1, direction: 'MINT_RECYCLE', refType: 'RECYCLE' },
  'waste-exchange/catalog/waste-gift-redemptions.service.ts': { count: 1, direction: 'REFUND_GIFT', refType: 'GIFT_REFUND' },
};

const APPLY_POINTS_DELTA_ALLOWLIST: Record<string, { count: number; direction: 'DEBIT' | 'REFUND' }> = {
  'waste-exchange/home-pickup/waste-home-pickup-customer.service.ts': { count: 1, direction: 'DEBIT' },
  'waste-exchange/home-pickup/waste-home-pickup-ledger.ts': { count: 1, direction: 'REFUND' },
  'waste-exchange/receiving/waste-reverse.service.ts': { count: 1, direction: 'DEBIT' },
};

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function scanSourceForPointsCalls(relPath: string, rawSource: string): MintCallHit[] {
  const code = stripComments(rawSource);
  const hits: MintCallHit[] = [];
  const grantMatches = [...code.matchAll(/\.grant\s*\(/g)];
  if (grantMatches.length > 0) hits.push({ relPath, kind: 'grant', count: grantMatches.length });
  const deltaMatches = [...code.matchAll(/\bapplyPointsDelta\s*\(/g)];
  if (deltaMatches.length > 0) hits.push({ relPath, kind: 'applyPointsDelta', count: deltaMatches.length });
  return hits;
}

export function verifyAllowlistHits(hits: MintCallHit[]): string[] {
  const errors: string[] = [];
  const grantSeen = new Map<string, number>();
  const deltaSeen = new Map<string, number>();

  for (const h of hits) {
    if (h.kind === 'grant') {
      const rule = GRANT_ALLOWLIST[h.relPath];
      if (!rule) errors.push(`Unauthorized .grant( call in ${h.relPath} (${h.count}x)`);
      else if (rule.count !== h.count) errors.push(`Expected ${rule.count} .grant( call(s) in ${h.relPath}, found ${h.count}`);
      grantSeen.set(h.relPath, h.count);
    } else {
      const rule = APPLY_POINTS_DELTA_ALLOWLIST[h.relPath];
      if (!rule) errors.push(`Unauthorized applyPointsDelta( call in ${h.relPath} (${h.count}x)`);
      else if (rule.count !== h.count) errors.push(`Expected ${rule.count} applyPointsDelta( call(s) in ${h.relPath}, found ${h.count}`);
      deltaSeen.set(h.relPath, h.count);
    }
  }

  for (const [path, rule] of Object.entries(GRANT_ALLOWLIST)) {
    if (!grantSeen.has(path)) errors.push(`Pinned .grant( allowlist entry missing: ${path} (${rule.direction})`);
  }
  for (const [path, rule] of Object.entries(APPLY_POINTS_DELTA_ALLOWLIST)) {
    if (!deltaSeen.has(path)) errors.push(`Pinned applyPointsDelta( allowlist entry missing: ${path} (${rule.direction})`);
  }
  return errors;
}

function listNonSpecTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listNonSpecTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.race-spec.ts')) out.push(full);
  }
  return out.sort();
}

describe('W179-A (P1) — Danh sách cho phép cộng/trừ Điểm Xanh trong waste-exchange & gomdon', () => {
  it('chỉ đúng các file được ghim gọi .grant( hoặc applyPointsDelta(; gomdon/** tuyệt đối không có lệnh cộng điểm', () => {
    const files = SCANNED_DIRS.flatMap(listNonSpecTsFiles);
    expect(files.length).toBeGreaterThan(25);

    const hits: MintCallHit[] = [];
    for (const f of files) {
      const rel = relative(MODULES_ROOT, f).split(sep).join('/');
      hits.push(...scanSourceForPointsCalls(rel, readFileSync(f, 'utf-8')));
    }

    expect(hits.filter((h) => h.relPath.startsWith('integrations/gomdon/'))).toEqual([]);
    expect(verifyAllowlistHits(hits)).toEqual([]);

    // Xác minh riêng refType 'RECYCLE' chỉ nằm ở waste-confirm.service.ts
    const confirmCode = stripComments(readFileSync(join(MODULES_ROOT, 'waste-exchange/receiving/waste-confirm.service.ts'), 'utf-8'));
    expect(confirmCode).toMatch(/\.grant\([^;]*'RECYCLE'/);
  });

  it('bộ quét thật sự báo lỗi ngay khi có thêm lệnh .grant( hoặc applyPointsDelta( trái phép (mục §4.5)', () => {
    const baseline = [
      ...Object.entries(GRANT_ALLOWLIST).map(([relPath, r]) => ({ relPath, kind: 'grant' as const, count: r.count })),
      ...Object.entries(APPLY_POINTS_DELTA_ALLOWLIST).map(([relPath, r]) => ({ relPath, kind: 'applyPointsDelta' as const, count: r.count })),
    ];
    expect(verifyAllowlistHits(baseline)).toEqual([]);

    const rogueWebhook = [
      ...baseline,
      ...scanSourceForPointsCalls(
        'waste-exchange/home-pickup/waste-home-pickup.service.ts',
        `// giả sử ai đó cộng điểm ngay khi shipper lấy rác\nawait this.rewards.grant(req.userId, req.estimatedPoints, 'RECYCLE:EARLY', 'RECYCLE', req.id, tx);`,
      ),
    ];
    expect(verifyAllowlistHits(rogueWebhook)).toEqual([
      'Unauthorized .grant( call in waste-exchange/home-pickup/waste-home-pickup.service.ts (1x)',
    ]);

    const rogueDelta = [
      ...baseline,
      ...scanSourceForPointsCalls(
        'integrations/gomdon/gomdon-webhook.service.ts',
        `await applyPointsDelta(tx, { userId: 'u1', delta: 5000, lot: 'STANDARD', reason: 'BONUS' });`,
      ),
    ];
    expect(verifyAllowlistHits(rogueDelta)).toEqual([
      'Unauthorized applyPointsDelta( call in integrations/gomdon/gomdon-webhook.service.ts (1x)',
    ]);
  });
});
