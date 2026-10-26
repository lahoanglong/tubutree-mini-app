import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSecretKey } from '../admin/config-redaction';
import { isDeadConfigKey } from './dead-config-keys';
import { SystemConfigController } from './system-config.controller';
import type { SystemConfigService } from './system-config.service';

type SeedRow = { key: string; value: unknown; category: string; createOnly?: boolean };

/** Đọc mảng SYSTEM_CONFIGS trong prisma/seed.ts (import seed.ts sẽ chạy main() → cần DB). */
function seededConfigs(): SeedRow[] {
  const src = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
  const start = src.indexOf('const SYSTEM_CONFIGS: ConfigSeed[] = [');
  expect(start).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  const factory = new Function('Prisma', `return ${src.slice(open, end + 2)};`) as (p: unknown) => unknown;
  return factory({ Decimal: Number }) as SeedRow[];
}

const supportRows = () => seededConfigs().filter((r) => r.key.startsWith('support.'));

/** Q-17: hotline/email do admin sửa ở tab Cấu hình, Zalo OA chưa có thì để trống để ẩn dòng. */
describe('Khoá liên hệ CSKH trong seed (Q-17)', () => {
  it('đúng bốn khoá, giá trị chủ dự án chốt, Zalo OA để trống (không bịa)', () => {
    expect(Object.fromEntries(supportRows().map((r) => [r.key, r.value]))).toEqual({
      'support.hotline': '0984 606 774',
      'support.email': 'tubutree@gmail.com',
      'support.hours': '8:00–21:00 mỗi ngày',
      'support.zalo_oa_name': '',
    });
  });

  it('createOnly: seed chạy lại mỗi lần deploy không được ghi đè giá trị admin đã sửa', () => {
    const rows = supportRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.createOnly !== true).map((r) => r.key)).toEqual([]);
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(['support']));
  });

  it('admin xem/sửa được: không bị che như bí mật, không bị gắn nhãn "Không dùng"', () => {
    for (const { key } of supportRows()) {
      expect(isSecretKey(key)).toBe(false);
      expect(isDeadConfigKey(key)).toBe(false);
    }
  });

  it('seed khớp giá trị mặc định của GET /config/public (khoá thiếu thì trả đúng bản seed)', async () => {
    const config = {
      get: jest.fn(async (_key: string, fallback?: unknown) => fallback),
    } as unknown as SystemConfigService;
    const { support } = await new SystemConfigController(config).publicConfig();
    const seeded = Object.fromEntries(supportRows().map((r) => [r.key, r.value]));
    expect(support).toEqual({
      hotline: seeded['support.hotline'],
      email: seeded['support.email'],
      zaloOaName: null,
      hours: seeded['support.hours'],
    });
  });
});

/** Link cộng đồng: seed createOnly tạo dòng trước, nên giá trị seed (không phải mặc định trong mã) là thứ khách thấy sau deploy đầu. */
describe('Link cộng đồng trong seed', () => {
  const communityRows = () => seededConfigs().filter((r) => ['community.zalo_group_url', 'community.facebook_url', 'community.tiktok_url'].includes(r.key));

  it('Facebook/TikTok là kênh trên website chủ dự án, chưa có nhóm Zalo thì để trống', () => {
    expect(Object.fromEntries(communityRows().map((r) => [r.key, r.value]))).toEqual({
      'community.zalo_group_url': '',
      'community.facebook_url': 'https://www.facebook.com/tubutree',
      'community.tiktok_url': 'https://www.tiktok.com/@tubutree.com',
    });
    expect(communityRows().every((r) => r.createOnly === true)).toBe(true);
  });

  it('seed khớp mặc định của GET /config/public', async () => {
    const config = { get: jest.fn(async (_key: string, fallback?: unknown) => fallback) } as unknown as SystemConfigService;
    const { community } = (await new SystemConfigController(config).publicConfig()) as unknown as {
      community: { zaloGroupUrl: string | null; facebookUrl: string | null; tiktokUrl: string | null };
    };
    const seeded = Object.fromEntries(communityRows().map((r) => [r.key, r.value]));
    expect(community).toMatchObject({
      zaloGroupUrl: null,
      facebookUrl: seeded['community.facebook_url'],
      tiktokUrl: seeded['community.tiktok_url'],
    });
  });
});
