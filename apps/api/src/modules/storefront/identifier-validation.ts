import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_IDENTIFIER_COOLDOWN_DAYS } from '../merchant/merchant-config';

/**
 * `slug`, `subdomain`, `customDomain` trên Storefront mỗi cột `@unique` RIÊNG — nhưng mọi nơi
 * ĐỌC (resolve gian hàng theo host/slug, tra cứu QR ngân hàng...) lại trộn cả 3 cột bằng `OR`.
 * Trước đây 2 nơi GHI (merchant.service.ts, storefront.service.ts) chỉ kiểm trùng trong CHÍNH
 * cột đang ghi — một CTV có thể đặt `subdomain`/`customDomain` trùng `slug` (hoặc `subdomain`)
 * của gian hàng KHÁC, khiến truy vấn `OR` phía đọc trả về 2 dòng và có thể lộ/giả mạo gian hàng
 * người khác (P0-1/P0-2, docs/2026-09-08-review-progress.md). Dùng CHUNG 2 hàm này ở cả 2 nơi
 * ghi để trần validate không bao giờ lệch nhau.
 */
export const RESERVED_STOREFRONT_IDENTIFIERS = new Set([
  'admin', 'api', 'www', 'app', 'mail', 'staging', 'dev', 'static', 'cdn',
  'auth', 'shop', 'tubutree', 'tubu', 'root', 'system', 'dashboard', 'demo',
]);

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
// Bắt buộc có ít nhất 1 dấu chấm (tên miền thật, vd shop.example.com) — subdomain/slug theo
// SUBDOMAIN_RE ở trên KHÔNG BAO GIỜ chứa dấu chấm, nên yêu cầu này tự nhiên tách biệt 2 không
// gian tên: customDomain không thể trùng ký tự với bất kỳ subdomain/slug nào, kể cả trước khi
// chạy tới bước kiểm trùng DB bên dưới.
const CUSTOM_DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Chuẩn hoá + validate format subdomain. Ném BadRequestException nếu không hợp lệ/thuộc từ khoá hệ thống. */
export function normalizeSubdomain(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(clean)) {
    throw new BadRequestException(
      'Subdomain không hợp lệ (độ dài 3-30 ký tự, chỉ chữ thường a-z, số 0-9 và dấu gạch ngang, không bắt đầu/kết thúc bằng dấu gạch ngang).',
    );
  }
  if (RESERVED_STOREFRONT_IDENTIFIERS.has(clean)) {
    throw new BadRequestException(`"${clean}" thuộc từ khóa hệ thống, vui lòng chọn tên khác.`);
  }
  return clean;
}

/**
 * Chuẩn hoá + validate format tên miền riêng (customDomain). Trước đây KHÔNG có validate nào —
 * bất kỳ chuỗi nào (kể cả trùng subdomain người khác) đều được ghi thẳng (P0-1).
 */
export function normalizeCustomDomain(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (!CUSTOM_DOMAIN_RE.test(clean)) {
    throw new BadRequestException(
      'Tên miền riêng không hợp lệ — cần đúng định dạng tên miền (vd: shop.tencuaban.vn).',
    );
  }
  // KHÔNG áp RESERVED_STOREFRONT_IDENTIFIERS ở đây — danh sách đó chặn label trong không gian
  // tên PHỤ (subdomain) do TA quản lý trên *.tubutree.com; customDomain là tên miền KHÁCH TỰ
  // SỞ HỮU (DNS riêng), "shop.example.com" là mẫu hợp lệ dù "shop" trùng 1 từ khóa hệ thống.
  return clean;
}

/**
 * Kiểm trùng CHÉO cả 3 cột (slug/subdomain/customDomain) — không chỉ cột đang ghi. Đây là lớp
 * chặn CHÍNH cho P0-1 (subdomain trùng slug người khác) và P0-2 (đơn hàng lộ qua slug trùng).
 */
export async function assertIdentifierAvailable(
  prisma: Pick<PrismaService, 'storefront'> & Partial<Pick<PrismaService, 'releasedStorefrontIdentifier'>>,
  value: string,
  excludeStorefrontId: string,
  cooldownDays: number = DEFAULT_IDENTIFIER_COOLDOWN_DAYS,
): Promise<void> {
  const existing = await prisma.storefront.findFirst({
    where: {
      OR: [{ slug: value }, { subdomain: value }, { customDomain: value }],
      NOT: { id: excludeStorefrontId },
    },
  });
  if (existing) {
    throw new BadRequestException(`"${value}" đã được sử dụng bởi gian hàng khác, vui lòng chọn tên khác.`);
  }
  // SELLER-5: link cũ của gian hàng vừa đổi tên vẫn nằm trong tin nhắn, bài đăng của khách; gian hàng khác nhận ngay tên đó là
  // nhận luôn khách (và ghi công đơn) của người trước. Chủ cũ lấy lại tên của chính mình thì được.
  if (!prisma.releasedStorefrontIdentifier) return;
  const released = await prisma.releasedStorefrontIdentifier.findUnique({ where: { value } });
  if (
    released &&
    released.storefrontId !== excludeStorefrontId &&
    released.releasedAt.getTime() > Date.now() - cooldownDays * 86_400_000
  ) {
    throw new BadRequestException(
      `"${value}" vừa được một gian hàng khác ngừng dùng, tạm thời chưa thể đăng ký lại. Vui lòng chọn tên khác.`,
    );
  }
}

/**
 * Ghi lại subdomain/tên miền gian hàng vừa nhả (đổi sang tên mới hoặc xoá) để `assertIdentifierAvailable` giữ cách ly.
 */
export async function recordReleasedIdentifiers(
  prisma: Pick<PrismaService, 'releasedStorefrontIdentifier'>,
  storefrontId: string,
  previous: Array<string | null | undefined>,
  next: Array<string | null | undefined>,
): Promise<void> {
  const keep = new Set(next.filter((v): v is string => !!v));
  const releasedAt = new Date();
  for (const value of previous) {
    if (!value || keep.has(value)) continue;
    await prisma.releasedStorefrontIdentifier.upsert({
      where: { value },
      create: { value, storefrontId, releasedAt },
      update: { storefrontId, releasedAt },
    });
  }
}
