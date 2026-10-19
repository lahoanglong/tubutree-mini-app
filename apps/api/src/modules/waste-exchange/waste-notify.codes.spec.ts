import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationCategory } from '../notifications/notification-categories';
import { WASTE_TEMPLATE_CODES } from './waste-notify.codes';

const SEED = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
const SQL = readFileSync(join(__dirname, '../../../prisma/migrations/20261020000000_waste_exchange/migration.sql'), 'utf-8');

type Tpl = { id: string; code: string; channel: string; bodyTemplate: string; createOnly?: boolean };
function seededTemplates(): Tpl[] {
  const start = SEED.indexOf('const NOTIFICATION_TEMPLATES = [');
  const open = SEED.indexOf('[', SEED.indexOf('=', start));
  const end = SEED.indexOf('\n];', open);
  return new Function(`return ${SEED.slice(open, end + 2)};`)() as Tpl[];
}

const EXPECTED: [code: string, id: string, placeholders: string[], body: string][] = [
  ['WASTE_PARCEL_RECEIVED', 'nt-waste-parcel-received', ['code'], 'Kho Tubu đã nhận kiện của yêu cầu {{code}}. Tubu sẽ đếm và báo bạn kết quả cộng Điểm Xanh.'],
  ['WASTE_POINTS_CREDITED', 'nt-waste-points-credited', ['code', 'result'], 'Yêu cầu {{code}} đã đếm xong. {{result}}.'],
  ['WASTE_REQUEST_REJECTED', 'nt-waste-request-rejected', ['code', 'reason'], 'Yêu cầu {{code}} chưa được nhận: {{reason}}. Bạn xem chi tiết trong mục Đổi rác.'],
  ['WASTE_REQUEST_EXPIRED', 'nt-waste-request-expired', ['code', 'detail'], 'Yêu cầu {{code}} đã đóng: {{detail}}.'],
  ['WASTE_PICKUP_STARTED', 'nt-waste-pickup-started', ['code', 'until'], 'Đơn mua của bạn đã giao. Nếu người giao hàng đã nhận phần rác của yêu cầu {{code}}, kiện sẽ về kho Tubu. Tubu chờ kiện tới khoảng ngày {{until}}.'],
  ['WASTE_PICKUP_CANCELLED', 'nt-waste-pickup-cancelled', ['code'], 'Đơn mua bị huỷ nên yêu cầu thu kèm rác {{code}} cũng đã đóng. Bạn tạo yêu cầu mới trong mục Đổi rác khi cần.'],
  ['WASTE_POINTS_REVERSED', 'nt-waste-points-reversed', ['code', 'points', 'reason'], 'Tubu đã thu hồi {{points}} Điểm Xanh của yêu cầu {{code}}. Lý do: {{reason}}.'],
  ['WASTE_SHIP_LOCKED', 'nt-waste-ship-locked', [], 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn. Bạn vẫn mang rác tới điểm nhận được. Yêu cầu thu kèm chưa gắn đơn (nếu có) sẽ được huỷ. Cần hỗ trợ, liên hệ Tubu Tree.'],
  ['WASTE_GIFT_CANCELLED', 'nt-waste-gift-cancelled', ['gift', 'points_note'], 'Lượt đổi quà {{gift}} đã bị huỷ.{{points_note}}'],
  ['WASTE_PERK_REVIEWED', 'nt-waste-perk-reviewed', ['point', 'result'], 'Ưu đãi riêng của điểm nhận {{point}}: {{result}}.'],
];
const render = (body: string, data: Record<string, string>) => body.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => data[k] ?? '');

describe('WASTE_TEMPLATE_CODES and the ten templates', () => {
  const seeded = seededTemplates();
  const a = SQL.indexOf('-- BEGIN WASTE TEMPLATES');
  const b = SQL.indexOf('-- END WASTE TEMPLATES');
  const section = a >= 0 && b > a ? SQL.slice(a, b) : '';

  it('exports the ten codes in registry order', () => {
    expect([...WASTE_TEMPLATE_CODES]).toEqual(EXPECTED.map((e) => e[0]));
  });
  it('no waste code is in the promotion catalogue, so every one is always sent (spec 11.6)', () => {
    for (const code of WASTE_TEMPLATE_CODES) expect(notificationCategory(code)).toBe('TRANSACTIONAL');
  });
  it.each(EXPECTED)('%s: seed row has the pinned id, body, placeholders and createOnly', (code, id, placeholders, body) => {
    const row = seeded.find((t) => t.code === code);
    expect(row).toEqual({ id, code, channel: 'INAPP', bodyTemplate: body, createOnly: true });
    expect([...new Set([...row!.bodyTemplate.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort()).toEqual([...placeholders].sort());
  });
  it('no waste body has an apostrophe, an emoji, the word voucher, or a standalone xu', () => {
    for (const [, , , body] of EXPECTED) {
      expect(body).not.toContain("'");
      expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(body).not.toMatch(/voucher/i);
      expect(body.replace(/\{\{\w+\}\}/g, '')).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
    }
  });
  it('migration section has one tuple per line, equal to the seed word for word, and ON CONFLICT DO NOTHING', () => {
    expect(a).toBeGreaterThanOrEqual(0);
    expect(section).toContain('INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES');
    expect(section).toContain('ON CONFLICT DO NOTHING;');
    const lines = section.split('\n').filter((l) => l.trim().startsWith("('"));
    expect(lines).toHaveLength(10);
    const tuples = [...section.matchAll(/\('([^']+)', '([A-Z_]+)', '([A-Z]+)', '([^']*)'\)/g)];
    expect(tuples.map((m) => ({ id: m[1], code: m[2], channel: m[3], bodyTemplate: m[4] }))).toEqual(
      EXPECTED.map(([code, id, , body]) => ({ id, code, channel: 'INAPP', bodyTemplate: body })),
    );
  });
  it('migration content follows the order of spec 11.7: enums, tables, ordinary indexes, hand-written constraints, seed, config rows, templates', () => {
    const marks = ['CREATE TYPE "WasteItemStatus"', 'CREATE TABLE "waste_requests"', 'CREATE INDEX "waste_requests_trackingNorm_idx"', '-- BEGIN WASTE HAND-WRITTEN CONSTRAINTS', '-- BEGIN WASTE SEED DATA', '-- BEGIN WASTE CONFIG ROWS', '-- BEGIN WASTE TEMPLATES'];
    const pos = marks.map((m) => SQL.indexOf(m));
    expect(marks.filter((_m, i) => pos[i]! < 0)).toEqual([]);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    expect(SQL.lastIndexOf('CREATE TABLE "')).toBeLessThan(pos[3]!);
    expect(SQL.lastIndexOf('CREATE INDEX "')).toBeLessThan(pos[3]!);
  });
  it('rendered sentences read correctly', () => {
    const body = (c: string) => EXPECTED.find((e) => e[0] === c)![3];
    expect(render(body('WASTE_POINTS_CREDITED'), { code: 'TR-A2C4E', result: 'Tubu đã cộng 12.000 Điểm Xanh và 4 giọt nước' })).toBe(
      'Yêu cầu TR-A2C4E đã đếm xong. Tubu đã cộng 12.000 Điểm Xanh và 4 giọt nước.',
    );
    expect(render(body('WASTE_GIFT_CANCELLED'), { gift: 'Túi vải Tubu', points_note: ' Tubu đã hoàn 20.000 Điểm Xanh vào tài khoản của bạn.' })).toBe(
      'Lượt đổi quà Túi vải Tubu đã bị huỷ. Tubu đã hoàn 20.000 Điểm Xanh vào tài khoản của bạn.',
    );
  });
});
