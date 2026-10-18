import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Trang /refill của miniapp bị gỡ (spec 13.2), nên bộ script audit/uiux không còn mô tả trang đó,
 * seed dữ liệu chỉ phục vụ nó, hay chấm điểm một trang không còn tồn tại.
 * Spec đọc file NGOÀI package apps/api (scripts/audit, scripts/uiux ở gốc repo).
 */

const REPO = join(__dirname, '../../../..');
const AUDIT_DIR = join(REPO, 'scripts/audit');
const UIUX_DIR = join(REPO, 'scripts/uiux');

const SKIPPED_DIRS = new Set(['node_modules', 'results', '.probe', 'generated']);

function walk(dir: string, out: string[] = [], skipped: ReadonlySet<string> = SKIPPED_DIRS): string[] {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, skipped);
    else out.push(p);
  }
  return out;
}

const files = [...walk(AUDIT_DIR), ...walk(UIUX_DIR)];
const rel = (p: string): string => relative(REPO, p);

const NEW_PATTERNS = ['/recycle', '/recycle/rules', '/recycle/new', '/recycle/points', '/recycle/requests', '/rewards', '/rewards/mine', '/recycle/desk'];

describe('script audit/uiux không còn dấu vết Refill (spec 13.2)', () => {
  it('không file nào nhắc đường dẫn /refill', () => {
    const offenders = files.filter((f) => /['"`]\/refill(?![\w-])/.test(readFileSync(f, 'utf-8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('seed audit không còn gieo bottleReturn, promo fuwa-refill hay huy hiệu REFILL_HERO', () => {
    const content = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8');
    expect(/prisma\s*\.\s*bottleReturn\s*\./.test(content)).toBe(false);
    expect(content).not.toContain('fuwa-refill');
    expect(content).not.toContain('REFILL_HERO');
  });

  it('routes.json có trang Đổi rác và Kho quà, không còn /refill', () => {
    const doc = JSON.parse(readFileSync(join(AUDIT_DIR, 'routes.json'), 'utf-8')) as { miniapp: { pattern: string; personas: string[]; examples: string[] }[] };
    const patterns = doc.miniapp.map((r) => r.pattern);
    expect(patterns).not.toContain('/refill');
    for (const p of NEW_PATTERNS) expect(patterns).toContain(p);
    expect(doc.miniapp.find((r) => r.pattern === '/recycle/desk')?.personas).toEqual(['staff', 'admin']);
    expect(doc.miniapp.find((r) => r.pattern === '/rewards')?.examples).toEqual(['/rewards']);
  });

  it('buildRoutes của seed audit có cùng các trang mới', () => {
    const content = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8');
    for (const p of NEW_PATTERNS) expect(content).toContain(`{ pattern: '${p}', `);
  });

  it('routes.mjs của bộ chụp có mọi trang mới, scorecard không còn dòng refill', () => {
    const routes = readFileSync(join(UIUX_DIR, 'routes.mjs'), 'utf-8');
    for (const p of ["'/recycle'", "'/recycle/new'", "'/recycle/points'", "'/recycle/requests'", "'/recycle/rules'", "'/recycle/desk'", "'/rewards'", "'/rewards/mine'"]) expect(routes).toContain(p);
    expect(/^\s*['"]?refill['"]?\s*:\s*\[/m.test(readFileSync(join(UIUX_DIR, 'scorecard.mjs'), 'utf-8'))).toBe(false);
  });

  it('hai danh sách endpoint sinh ra không còn Refill', () => {
    for (const f of ['generated/miniapp-endpoints.json', 'generated/web-endpoints.json']) {
      expect(readFileSync(join(UIUX_DIR, f), 'utf-8')).not.toMatch(/refill/i);
    }
    expect(readFileSync(join(UIUX_DIR, 'generated/miniapp-endpoints.json'), 'utf-8')).toContain('waste-api.ts');
  });
});

describe('tài liệu vận hành đã theo Đổi rác lấy quà (spec 13.2)', () => {
  const doc = (p: string) => readFileSync(join(REPO, p), 'utf-8');
  it('runbook: không còn Refill, có db.waste_point, năm chỉ mục của migration này báo thiếu trước deploy, race chạy trong race.yml và verify-full', () => {
    const r = doc('docs/launch/deploy-rollback-runbook.md');
    for (const gone of ['refill_pickup_locations', 'db.refill_location', 'Đổi vỏ chai']) expect(r).not.toContain(gone);
    for (const stale of ['năm cái của đợt', 'năm cái đó', 'tối đa năm cái', 'năm migration của đợt', 'năm tên này']) expect(r).not.toContain(stale);
    expect(r).not.toContain('không bao giờ chạy trong CI');
    for (const must of ['20261020000000_waste_exchange', 'db.waste_point', 'points_transactions_recycle_ref_key', 'points_transactions_recycle_reverse_key', 'points_transactions_gift_refund_key', 'waste_points_one_warehouse_key', 'waste_point_staff_one_owner_key', 'verify-full.sh', 'khởi động lại API', 'sáu tên này', 'hashtext(id) IN (731001,731002,731003,731004)', '.github/workflows/race.yml', 'Check "Race suite" đỏ trên PR phát hành là chặn phát hành', 'kho đang hoạt động chưa có số điện thoại', 'khoá `waste.lane_mailin_enabled` vắng cũng tính là bật', 'Quản trị, Khách hàng, Đổi rác, Điểm nhận']) expect(r).toContain(must);
    expect(r).not.toMatch(/Quản trị, Đổi rác, Điểm nhận/);
  });
  it('playbook: Phần 7 là Đổi rác, không còn bảng Refill hay ô tick tái chế cũ', () => {
    const p = doc('docs/launch/pilot-order-playbook.md');
    for (const gone of ['refill_pickup_locations', 'bottle_returns', 'refill.seeds_per_bottle', 'Gửi lại vật liệu tái chế', 'Đổi vỏ chai']) expect(p).not.toContain(gone);
    expect(p).not.toMatch(/hai điểm nhận vỏ/i);
    for (const must of ['waste_requests', 'Thu kèm rác', 'Thùng carton cũ: 3 thùng']) expect(p).toContain(must);
  });
  it('Gomdon và khoá go-live nói đúng công tắc mới', () => {
    expect(doc('docs/integrations/gomdon.md')).toContain('wasteRequestId');
    const k = doc('docs/GO-LIVE-KEYS.md');
    for (const must of ['waste.lane_pickup_enabled', 'ZALO_APP_SECRET', 'scope.userLocation', 'Khách chỉ thấy Thu kèm đơn khi bật thêm waste.enabled']) expect(k).toContain(must);
  });
  it('README không còn module refill', () => {
    expect(doc('README.md')).not.toMatch(/\brefill\b/);
  });
  it('checklist ra mắt có đủ tám mục', () => {
    const c = doc('docs/launch/recycle-rewards-launch-checklist.md');
    for (const h of ['## 1. Mặc định và tắt khẩn cấp', '## 2. Trước khi bật waste.enabled', '## 3. Việc chặn mở cho khách thật (bảng 14.8)', '## 4. Đường Thu kèm đơn (PICKUP)', '## 5. Chạy nội bộ', '## 6. SOP cửa kho', '## 7. Xử lý gian lận', '## 8. Giới hạn đã biết và số chưa kiểm chứng']) expect(c).toContain(h);
    for (const must of ['Tắt khẩn cấp: đặt waste.enabled = false, rồi khởi động lại API', 'Sở Công Thương', 'Sở Nông nghiệp và Môi trường', 'Gomdon', 'waste.lane_pickup_enabled', 'TR-', 'waste_user_flags.blockedAt', 'refundPoints', 'isActive = false', 'hashtext(id)', 'waste.mailin_fee_table', 'waste.rules_text', 'hạn điểm 12 tháng', '1–2 tháng', 'routes.json và personas.json', 'gõ số điện thoại thật của kho vào ô "Số điện thoại"']) expect(c).toContain(must);
    for (const s of ['/rewards/mine', '/recycle/r/:id/edit', '/recycle/rules', 'Chương trình đang tạm dừng', 'Cấu hình chung']) expect(c).toContain(s);
    for (const must of ['Mục 14 của spec không phải tư vấn pháp lý', 'Nghị định 128/2024', 'HAZARDOUS', 'chỉ bằng migration có người duyệt', 'được tính EPR', 'tái chế 100%', 'xử lý đúng chuẩn', '30 tỷ', 'scope.userLocation', 'ZALO_APP_SECRET', 'đại lý là bên xử lý dữ liệu']) expect(c).toContain(must);
    expect(c).not.toMatch(/R19\./);
    expect(c.match(/^- \[ \]/gm)?.length ?? 0).toBeGreaterThanOrEqual(25);
  });
});
