import { BadRequestException, Injectable } from '@nestjs/common';
import { FLASH_ALLOWANCE_MAX_ITEMS, type FlashAllowanceResponse } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { FlashSaleService } from './flash-sale.service';

const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RAW_LENGTH = FLASH_ALLOWANCE_MAX_ITEMS * 65;

/** `?items=a,b,c`: chuỗi các id suất, không trùng, tối đa 50. Sai dạng thì 400 (khách thấy ngay lỗi thay vì kết quả thiếu lặng lẽ). */
export function parseAllowanceItemIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '' || raw.length > MAX_RAW_LENGTH) {
    throw new BadRequestException(`items phải là danh sách id suất ngăn cách bằng dấu phẩy (tối đa ${FLASH_ALLOWANCE_MAX_ITEMS}).`);
  }
  const ids = [...new Set(raw.split(','))];
  if (ids.length > FLASH_ALLOWANCE_MAX_ITEMS || ids.some((id) => !ITEM_ID.test(id))) {
    throw new BadRequestException(`items phải là danh sách id suất ngăn cách bằng dấu phẩy (tối đa ${FLASH_ALLOWANCE_MAX_ITEMS}).`);
  }
  return ids;
}

/**
 * Số suất Giờ vàng khách còn mua được, theo từng suất. Danh sách Giờ vàng (`/active`, `/slots`) là cache dùng chung nên không mang số theo
 * khách; số này đi qua đây. Tính bằng chính `resolveEffective` mà giỏ và đặt đơn dùng, nên client hiển thị đúng số máy chủ sẽ tính.
 */
@Injectable()
export class FlashAllowanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flashSale: FlashSaleService,
  ) {}

  async forUser(userId: string, itemIds: string[], now: Date = new Date()): Promise<FlashAllowanceResponse> {
    const rows = await this.prisma.flashSaleItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, variationId: true } });
    const items: FlashAllowanceResponse['items'] = {};
    if (rows.length === 0) return { items };
    const effective = await this.flashSale.resolveEffective([...new Set(rows.map((r) => r.variationId))], now, userId);
    for (const row of rows) {
      const offer = effective.get(row.variationId);
      // Một phân loại chỉ có một suất đang chạy; offer của suất khác (đợt khác) không phải số của id được hỏi.
      if (offer && offer.itemId === row.id && offer.perUserLeft !== undefined && offer.allowance !== undefined) {
        items[row.id] = { perUserLeft: offer.perUserLeft, allowance: offer.allowance };
      }
    }
    return { items };
  }
}
