import { Injectable, NotFoundException } from '@nestjs/common';
import type { ExternalOrderSource, ExternalOrderStatus, Prisma } from '@prisma/client';
import { parseTypedVnPhone } from '../../common/phone';
import { maskPhoneOrNull } from '../../common/mask-pii';
import { paginated, skipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  DEFAULT_ORDER_SOURCE_MAP,
  ORDER_SOURCE_MAP_KEY,
  resolveOrderSourceMap,
  type OrderSourceMap,
} from './external-order.config';
import { classifyPancakeOrder, normalizeTrackingCode, type ExternalOrderKind } from './external-order.mapper';

export interface ExternalOrderListQuery {
  page: number;
  limit: number;
  q?: string;
  source?: ExternalOrderSource;
  status?: ExternalOrderStatus;
}

const SOURCE_KEY_LIMIT = 300;

/**
 * Xem đơn Pancake ngoài app (chỉ đọc). SĐT luôn che; `lastPayload` (nguyên payload Pancake, có SĐT/địa chỉ thật)
 * chỉ trả cho ADMIN ở màn chi tiết.
 */
@Injectable()
export class ExternalOrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  /** `q` thử lần lượt: mã đơn Pancake, mã vận đơn/mã đơn sàn (đã chuẩn hoá), SĐT đầy đủ. Không khớp dạng nào thì không có kết quả. */
  searchWhere(q: string | undefined): Prisma.ExternalOrderWhereInput {
    const text = q?.trim();
    if (!text) return {};
    const or: Prisma.ExternalOrderWhereInput[] = [{ pancakeOrderId: text }];
    const code = normalizeTrackingCode(text);
    if (code) or.push({ trackingCodes: { has: code } });
    const phone = parseTypedVnPhone(text);
    if (phone) or.push({ phone });
    return { OR: or };
  }

  async list(q: ExternalOrderListQuery) {
    const where: Prisma.ExternalOrderWhereInput = {
      ...this.searchWhere(q.q),
      ...(q.source ? { source: q.source } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const { skip, take } = skipTake(q.page, q.limit);
    const [rows, total] = await Promise.all([
      this.prisma.externalOrder.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ pancakeUpdatedAt: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.externalOrder.count({ where }),
    ]);
    return paginated(rows.map((r) => this.view(r)), q.page, q.limit, total);
  }

  async detail(id: string, isAdmin: boolean) {
    const row = await this.prisma.externalOrder.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy đơn ngoài app.');
    const { lastPayload, ...rest } = row;
    return { ...this.view(rest), ...(isAdmin ? { lastPayload } : {}) };
  }

  /** Mỗi `sourceKey` đã thấy: số đơn theo từng loại đang lưu và loại bản đồ hiện hành sẽ gán cho nguồn đó. */
  async sources() {
    const [groups, map] = await Promise.all([
      this.prisma.externalOrder.groupBy({
        by: ['sourceKey', 'source'],
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      this.currentMap(),
    ]);
    const byKey = new Map<string, { sourceKey: string; total: number; bySource: Record<string, number>; lastSeenAt: Date | null }>();
    for (const g of groups) {
      const row = byKey.get(g.sourceKey) ?? { sourceKey: g.sourceKey, total: 0, bySource: {}, lastSeenAt: null };
      row.total += g._count._all;
      row.bySource[g.source] = g._count._all;
      const seen = g._max.updatedAt;
      if (seen && (!row.lastSeenAt || seen > row.lastSeenAt)) row.lastSeenAt = seen;
      byKey.set(g.sourceKey, row);
    }
    const rows = [...byKey.values()]
      .sort((a, b) => b.total - a.total || a.sourceKey.localeCompare(b.sourceKey))
      .slice(0, SOURCE_KEY_LIMIT)
      .map((r) => {
        const [orderSources = '', account = '', marketplaceId = ''] = r.sourceKey.split('|');
        const current = classifyPancakeOrder({ order_sources: orderSources, account, marketplace_id: marketplaceId }, map);
        return { ...r, orderSources, account, marketplaceId, currentKind: kindForKey(current.kind, r.bySource), currentChannel: current.channel };
      });
    return { sources: rows, truncated: byKey.size > SOURCE_KEY_LIMIT };
  }

  private async currentMap(): Promise<OrderSourceMap> {
    try {
      return resolveOrderSourceMap(await this.config.get<unknown>(ORDER_SOURCE_MAP_KEY, DEFAULT_ORDER_SOURCE_MAP));
    } catch {
      return DEFAULT_ORDER_SOURCE_MAP;
    }
  }

  private view<T extends { phone: string | null }>(r: T): Omit<T, 'phone'> & { phone: string | null } {
    return { ...r, phone: maskPhoneOrNull(r.phone) };
  }
}

/**
 * Bản đồ chỉ nhìn khoá nguồn nên không biết cờ is_from_ecommerce: khi bản đồ không gán được mà các đơn đã lưu của khoá này
 * là đơn sàn (nhờ cờ đó) thì vẫn báo MARKETPLACE thay vì nói "chưa biết".
 */
function kindForKey(mapped: ExternalOrderKind, bySource: Record<string, number>): ExternalOrderKind {
  if (mapped !== 'UNKNOWN') return mapped;
  return (bySource['MARKETPLACE'] ?? 0) > 0 ? 'MARKETPLACE' : 'UNKNOWN';
}

const LIST_SELECT = {
  id: true,
  pancakeOrderId: true,
  source: true,
  channel: true,
  sourceKey: true,
  trackingCode: true,
  trackingCodes: true,
  marketplaceOrderSn: true,
  phone: true,
  phoneLast3: true,
  goodsValue: true,
  pancakeStatus: true,
  status: true,
  pancakeInsertedAt: true,
  pancakeUpdatedAt: true,
  deliveredAt: true,
  closedAt: true,
  firstSeenAt: true,
  updatedAt: true,
} satisfies Prisma.ExternalOrderSelect;
