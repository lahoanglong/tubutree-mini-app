import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ZnsClient } from '../integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

/**
 * C-053 (A1-019): mẫu thông báo thiếu thì khách nhận câu mặc định trung tính thay vì nội dung đúng. Đọc thẳng
 * mảng NOTIFICATION_TEMPLATES trong prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB) và đối chiếu với mã
 * mẫu mà code gọi notify().
 */
const SRC_ROOT = join(__dirname, '../..');
const SEED_PATH = join(__dirname, '../../../prisma/seed.ts');

type SeedTemplate = { id: string; code: string; channel: string; bodyTemplate: string; createOnly?: boolean };

function seededTemplates(): SeedTemplate[] {
  const src = readFileSync(SEED_PATH, 'utf-8');
  const start = src.indexOf('const NOTIFICATION_TEMPLATES = [');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  expect(end).toBeGreaterThan(open);
  return new Function(`return ${src.slice(open, end + 2)};`)() as SeedTemplate[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Mã mẫu truyền thẳng dạng chuỗi vào `.notify(userId, 'CODE', ...)` ở mã chạy thật (bỏ comment). */
function codesPassedToNotify(): Set<string> {
  const source = walk(SRC_ROOT)
    .map((p) => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
  const codes = new Set<string>();
  for (const m of source.matchAll(/notify\(\s*[^,()]*(?:\([^)]*\))?[^,()]*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) codes.add(m[1]!);
  return codes;
}

/** Tám mã finding A1-019 ghi là thiếu ở DB, cộng các mã code gọi gián tiếp (ORDER_${status}, VouchersService.grant). */
const REQUIRED_CODES = [
  'ACCOUNT_DELETION_REQUESTED',
  'DEALER_CREDIT_PAYMENT_CONFIRMED',
  'DEALER_CREDIT_PAYMENT_REPORTED',
  'FLASH_STARTING',
  'POINTS_EXPIRING',
  'RETURN_APPROVED_NO_REFUND',
  'STOREFRONT_TRENDING_PRODUCTS',
  'SUBSCRIPTION_ORDER_FAILED',
  'ORDER_CONFIRMED',
  'ORDER_PACKED',
  'ORDER_SHIPPING',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'ORDER_RETURNED',
  'WELCOME_VOUCHER',
  'BIRTHDAY_VOUCHER',
  'WINBACK_VOUCHER',
  'MILESTONE_VOUCHER',
];

describe('seed mẫu thông báo', () => {
  const templates = seededTemplates();
  const byCode = new Map(templates.map((t) => [t.code, t]));

  it('có đủ mọi mã mà finding A1-019 liệt kê và các mã code gọi gián tiếp', () => {
    expect(REQUIRED_CODES.filter((c) => !byCode.has(c))).toEqual([]);
  });

  it('mọi mã truyền thẳng vào notify() đều có mẫu trong seed', () => {
    const used = [...codesPassedToNotify()];
    expect(used.length).toBeGreaterThan(15);
    expect(used.filter((c) => !byCode.has(c))).toEqual([]);
  });

  it('id và code không trùng nhau (upsert theo id, code là unique ở DB)', () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    expect(byCode.size).toBe(templates.length);
  });

  describe('migration đưa mẫu thiếu lên prod (prod không chạy seed)', () => {
    const MIGRATION = join(__dirname, '../../../prisma/migrations/20261010150000_reference_data_templates_voucher_eta/migration.sql');
    const inserted = [...readFileSync(MIGRATION, 'utf-8').matchAll(/\('([^']+)', '([A-Z_]+)', '([A-Z]+)', '([^']*)'\)/g)].map((m) => ({
      id: m[1]!,
      code: m[2]!,
      channel: m[3]!,
      bodyTemplate: m[4]!,
    }));

    it('chèn đủ tám mã A1-019 và lời tin trùng từng chữ với seed (nếu lệch thì prod và dev nói hai câu khác nhau)', () => {
      expect(inserted.map((t) => t.code).sort()).toEqual(REQUIRED_CODES.slice(0, 8).sort());
      for (const t of inserted) expect(byCode.get(t.code)).toMatchObject({ id: t.id, channel: t.channel, bodyTemplate: t.bodyTemplate });
    });

    it('POINTS_EXPIRING viết "Điểm Xanh" hoa đúng thuật ngữ Q-26, cả seed lẫn migration', () => {
      for (const body of [byCode.get('POINTS_EXPIRING')!.bodyTemplate, inserted.find((t) => t.code === 'POINTS_EXPIRING')!.bodyTemplate]) {
        expect(body).toContain('Điểm Xanh');
        expect(body).not.toContain('điểm Xanh');
      }
    });
  });

  describe('lời tin đúng sự thật', () => {
    function makeSvc(code: string) {
      const tpl = byCode.get(code)!;
      const create = jest.fn().mockResolvedValue({ id: 'log-1' });
      const prisma = {
        notificationTemplate: { findUnique: jest.fn().mockResolvedValue({ ...tpl, zaloTemplateId: null }) },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', phone: null }) },
        notificationLog: { create },
      } as unknown as PrismaService;
      const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) } as unknown as AnalyticsEventsService;
      const svc = new NotificationsService(prisma, { sendTemplate: jest.fn() } as unknown as ZnsClient, analytics);
      return { svc, bodyOf: () => create.mock.calls[0][0].data.payload.body as string };
    }

    it('ORDER_DELIVERED: không khẳng định đã cộng Điểm Xanh khi đơn không tích điểm (trả bằng xu)', async () => {
      const { svc, bodyOf } = makeSvc('ORDER_DELIVERED');
      await svc.notify('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1' });
      expect(bodyOf()).toBe('Đơn TUBU1 đã giao thành công. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
      expect(bodyOf()).not.toContain('Điểm Xanh');
    });

    it('ORDER_DELIVERED: đơn có tích điểm → nêu đúng số điểm do points_note mang vào', async () => {
      const { svc, bodyOf } = makeSvc('ORDER_DELIVERED');
      await svc.notify('u1', 'ORDER_DELIVERED', { order_code: 'TUBU1', points_note: ' Bạn được cộng 12 Điểm Xanh.' });
      expect(bodyOf()).toBe('Đơn TUBU1 đã giao thành công. Bạn được cộng 12 Điểm Xanh. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿');
    });

    it('WELCOME_VOUCHER: nói rõ đơn tối thiểu và dùng thuật ngữ "mã giảm giá" (Q-26)', async () => {
      const { svc, bodyOf } = makeSvc('WELCOME_VOUCHER');
      await svc.notify('u1', 'WELCOME_VOUCHER', {
        code: 'WELCOME-U1',
        value: '30000',
        min_order_note: ' cho đơn từ 199.000đ',
        expires: '10/11/2026',
      });
      expect(bodyOf()).toContain('mã giảm giá WELCOME-U1');
      expect(bodyOf()).toContain('cho đơn từ 199.000đ');
      expect(bodyOf()).not.toContain('{{');
    });
  });
});
