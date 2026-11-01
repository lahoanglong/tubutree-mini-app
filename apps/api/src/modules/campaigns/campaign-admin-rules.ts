import { BadRequestException } from '@nestjs/common';
import type { CampaignLinkType } from '@prisma/client';
import { CAMPAIGN_INTERNAL_TARGETS } from '@tubutree/shared-types';

export type CampaignStatus = 'live' | 'scheduled' | 'ended' | 'off';

const SLUG_MAX = 80;
const ENTITY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;

/** "Chiến dịch Giữa Thu" → "chien-dich-giua-thu". Tiêu đề toàn ký hiệu vẫn ra một slug dùng được. */
export function slugFromTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug || 'chien-dich';
}

/**
 * Đích bấm lưu cùng chiến dịch. Đích nội bộ chỉ nhận đúng giá trị trong CAMPAIGN_INTERNAL_TARGETS: app chỉ dựng liên kết cho các đích đó,
 * nên đường dẫn khác (kể cả `/cart` hợp lệ về hình thức) lưu được thì banner lặng lẽ biến mất; `//host`, `javascript:` cũng bị chặn theo.
 */
export function normalizeLink(linkType: CampaignLinkType, raw: string | null | undefined): string | null {
  if (linkType === 'CAMPAIGN_PAGE') return null;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (linkType === 'URL_INTERNAL') {
    if (!CAMPAIGN_INTERNAL_TARGETS.some((t) => t.value === value)) {
      throw new BadRequestException(`Đích nội bộ phải chọn trong danh sách: ${CAMPAIGN_INTERNAL_TARGETS.map((t) => t.label).join(', ')}.`);
    }
    return value;
  }
  if (!ENTITY_SLUG_RE.test(value)) {
    throw new BadRequestException(linkType === 'PRODUCT' ? 'Nhập slug sản phẩm hợp lệ.' : 'Nhập slug danh mục hợp lệ.');
  }
  return value;
}

export function assertWindow(startAt: Date, endAt: Date): void {
  if (!(endAt.getTime() > startAt.getTime())) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
}

/** Cùng ranh giới với `liveWhere`: đúng lúc `endAt` là đã kết thúc, đúng lúc `startAt` là đang chạy. */
export function campaignStatus(c: { isActive: boolean; startAt: Date; endAt: Date }, now: Date): CampaignStatus {
  if (!c.isActive) return 'off';
  if (c.startAt > now) return 'scheduled';
  if (c.endAt <= now) return 'ended';
  return 'live';
}
