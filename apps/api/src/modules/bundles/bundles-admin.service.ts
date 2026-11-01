import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { actorUserId, loadStaffCouponCaps, type CouponActor } from '../admin/coupon-input-rules';
import { VARIATION_ORDER_BY, cardPrices } from '../catalog/variation-order';
import { SystemConfigService } from '../system-config/system-config.service';
import { readBundleMaxPct } from './bundle-read';
import {
  assertBundleWindow,
  assertStaffBundleCaps,
  bundleStatus,
  normalizeBundleContent,
  resolveBundleItems,
  type BundleContent,
  type ResolvedBundleItem,
  type BundleKindValue,
  type BundleStatus,
  type CatalogProduct,
} from './bundle-admin-rules';
import type { CreateBundleDto, UpdateBundleDto } from './dto/bundle.dto';

export interface AdminBundleItem {
  productId: string;
  productName: string;
  productSlug: string;
  variationId: string | null;
  variationName: string | null;
  addonPrice: number | null;
  maxQty: number;
  /** Giá đang bán của món (phân loại ghim hoặc đại diện) để form báo "giảm bao nhiêu". */
  price: number;
}

export interface AdminBundle {
  id: string;
  kind: BundleKindValue;
  title: string;
  pct: number | null;
  anchorProductId: string | null;
  anchorProductName: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
  sortOrder: number;
  status: BundleStatus;
  createdById: string | null;
  /** Nhân viên chỉ sửa/xoá được bộ do nhân viên tạo: màn quản trị khoá nút khi false. */
  createdByStaff: boolean;
  items: AdminBundleItem[];
}

const STAFF_BUNDLE_MSG = 'Bộ này do quản trị viên tạo (hoặc không rõ người tạo) — nhờ quản trị viên chỉnh sửa.';
const LIST_LIMIT = 200;

const DETAIL_INCLUDE = {
  anchorProduct: { select: { name: true } },
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      variation: { select: { name: true } },
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          basePrice: true,
          salePrice: true,
          variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
        },
      },
    },
  },
} satisfies Prisma.BundleInclude;

type DetailRow = Prisma.BundleGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const STATUS_WHERE = (now: Date): Record<BundleStatus, Prisma.BundleWhereInput> => ({
  live: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
  scheduled: { isActive: true, startAt: { gt: now } },
  ended: { isActive: true, endAt: { lte: now } },
  off: { isActive: false },
});

@Injectable()
export class BundlesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async list(status: BundleStatus | undefined, now: Date = new Date()): Promise<AdminBundle[]> {
    const rows = await this.prisma.bundle.findMany({
      where: status ? STATUS_WHERE(now)[status] : {},
      orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
      take: LIST_LIMIT,
      include: DETAIL_INCLUDE,
    });
    const staff = await this.staffCreators(rows.map((r) => r.createdById));
    return rows.map((r) => toAdminBundle(r, now, staff));
  }

  async get(id: string, now: Date = new Date()): Promise<AdminBundle> {
    const row = await this.prisma.bundle.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw new NotFoundException('Không tìm thấy bộ combo/mua kèm.');
    return toAdminBundle(row, now, await this.staffCreators([row.createdById]));
  }

  async create(dto: CreateBundleDto, actor: CouponActor, now: Date = new Date()): Promise<AdminBundle> {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    assertBundleWindow(startAt, endAt);
    const content = normalizeBundleContent(dto, await readBundleMaxPct(this.config));
    const resolved = await this.validateContent(content, actor);
    const created = await this.prisma.bundle.create({
      data: {
        kind: content.kind,
        title: dto.title,
        pct: content.pct,
        anchorProductId: content.anchorProductId,
        startAt,
        endAt,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
        createdById: actorUserId(actor),
        items: { create: withRefPrices(content, resolved) },
      },
      select: { id: true },
    });
    return this.get(created.id, now);
  }

  /**
   * Mọi kiểm tra (người tạo, khung giờ, nội dung, trần nhân viên) chạy trên dòng đọc SAU khi giữ khoá hàng. Đọc trước khoá thì hai PATCH
   * đồng thời mỗi cái gộp `dto` của mình với dòng cũ rồi qua trần (một cái đổi % , một cái đổi món), ghép lại vượt `coupon.staff_max_amount_vnd`.
   */
  async update(id: string, dto: UpdateBundleDto, actor: CouponActor, now: Date = new Date()): Promise<AdminBundle> {
    await this.prisma.$transaction(async (tx) => {
      // Hai người sửa cùng lúc: người sau chờ ở đây, rồi đọc lại bộ đã có thay đổi của người trước (nếu không, cả hai cùng xoá bản cũ rồi cùng ghi).
      await tx.$queryRaw`SELECT "id" FROM "bundles" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.bundle.findUnique({ where: { id }, include: DETAIL_INCLUDE });
      if (!current) throw new NotFoundException('Không tìm thấy bộ combo/mua kèm.');
      if (actor.staff) await this.assertStaffCreated(current.createdById);

      const startAt = dto.startAt === undefined ? undefined : new Date(dto.startAt);
      const endAt = dto.endAt === undefined ? undefined : new Date(dto.endAt);
      if (startAt || endAt) assertBundleWindow(startAt ?? current.startAt, endAt ?? current.endAt);

      // Chỉ khi đụng tới % / sản phẩm chính / món mới kiểm lại catalog và trần: bật/tắt, đổi tên hay thứ tự vẫn làm được khi
      // sản phẩm trong bộ đã ngừng bán (đúng lúc cần tắt bộ).
      let content: BundleContent | undefined;
      let resolved: ResolvedBundleItem[] = [];
      if (dto.pct !== undefined || dto.anchorProductId !== undefined || dto.items !== undefined) {
        content = normalizeBundleContent(
          {
            kind: current.kind,
            pct: dto.pct !== undefined ? dto.pct : current.pct,
            anchorProductId: dto.anchorProductId !== undefined ? dto.anchorProductId : current.anchorProductId,
            items: dto.items ?? current.items.map((i) => ({ productId: i.productId, variationId: i.variationId, addonPrice: i.addonPrice, maxQty: i.maxQty })),
          },
          await readBundleMaxPct(this.config),
        );
        resolved = await this.validateContent(content, actor);
      }

      const replaceItems = dto.items !== undefined && content !== undefined;
      const data: Prisma.BundleUpdateInput = {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(startAt ? { startAt } : {}),
        ...(endAt ? { endAt } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(content ? { pct: content.pct, anchorProduct: content.anchorProductId ? { connect: { id: content.anchorProductId } } : { disconnect: true } } : {}),
        ...(replaceItems ? { items: { create: withRefPrices(content!, resolved) } } : {}),
      };
      if (replaceItems) await tx.bundleItem.deleteMany({ where: { bundleId: id } });
      await tx.bundle.update({ where: { id }, data });
    });
    return this.get(id, now);
  }

  /** Xoá cả bộ đang chạy cũng được: bộ không có quota hay ràng buộc đơn nên không có gì treo (giá của đơn đã đặt nằm ở đơn). */
  async remove(id: string, actor: CouponActor): Promise<{ ok: true }> {
    if (actor.staff) {
      const row = await this.prisma.bundle.findUnique({ where: { id }, select: { createdById: true } });
      if (!row) throw new NotFoundException('Không tìm thấy bộ combo/mua kèm.');
      await this.assertStaffCreated(row.createdById);
    }
    const { count } = await this.prisma.bundle.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Không tìm thấy bộ combo/mua kèm.');
    return { ok: true };
  }

  private async validateContent(content: BundleContent, actor: CouponActor): Promise<ResolvedBundleItem[]> {
    const ids = [...new Set([...(content.anchorProductId ? [content.anchorProductId] : []), ...content.items.map((i) => i.productId)])];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        isActive: true,
        approvalStatus: true,
        storefrontId: true,
        basePrice: true,
        salePrice: true,
        variations: { where: { isActive: true }, orderBy: VARIATION_ORDER_BY, select: { id: true, sku: true, retailPrice: true, salePrice: true, stock: true } },
      },
    });
    const resolved = resolveBundleItems(content, new Map<string, CatalogProduct>(rows.map((p) => [p.id, p])));
    if (actor.staff) assertStaffBundleCaps(content, resolved, await loadStaffCouponCaps(this.config));
    return resolved;
  }

  /** Nhân viên chỉ đụng bộ do nhân viên tạo (mẫu `assertStaffCreated` của Giờ vàng). */
  private async assertStaffCreated(createdById: string | null): Promise<void> {
    const creator = createdById ? await this.prisma.user.findUnique({ where: { id: createdById }, select: { role: true } }) : null;
    if (creator?.role !== 'STAFF') throw new ForbiddenException(STAFF_BUNDLE_MSG);
  }

  private async staffCreators(createdByIds: readonly (string | null)[]): Promise<ReadonlySet<string>> {
    const ids = [...new Set(createdByIds.filter((x): x is string => x !== null))];
    if (ids.length === 0) return new Set();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
    return new Set(users.filter((u) => u.role === 'STAFF').map((u) => u.id));
  }
}

/**
 * Món ghi xuống kèm `refPrice`: ADDON lưu giá đang bán của phân loại ghim LÚC NÀY, làm trần khoản giảm mỗi đơn vị khi phân loại đổi giá về
 * sau (`addonUnitDiscount`). BUNDLE_PCT không có giá cố định nên không cần.
 */
function withRefPrices(content: BundleContent, resolved: readonly ResolvedBundleItem[]) {
  return content.items.map((it, i) => ({ ...it, refPrice: content.kind === 'ADDON' ? (resolved[i]?.price ?? null) : null }));
}

function toAdminBundle(b: DetailRow, now: Date, staffCreators: ReadonlySet<string>): AdminBundle {
  return {
    id: b.id,
    kind: b.kind,
    title: b.title,
    pct: b.pct,
    anchorProductId: b.anchorProductId,
    anchorProductName: b.anchorProduct?.name ?? null,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    isActive: b.isActive,
    sortOrder: b.sortOrder,
    status: bundleStatus(b, now),
    createdById: b.createdById,
    createdByStaff: b.createdById !== null && staffCreators.has(b.createdById),
    items: b.items.map((i) => {
      const pinned = i.variationId ? i.product.variations.find((v) => v.id === i.variationId) : undefined;
      const card = cardPrices(i.product, i.product.variations);
      return {
        productId: i.productId,
        productName: i.product.name,
        productSlug: i.product.slug,
        variationId: i.variationId,
        variationName: i.variation?.name ?? null,
        addonPrice: i.addonPrice,
        maxQty: i.maxQty,
        price: pinned ? (pinned.salePrice ?? pinned.retailPrice) : (card.salePrice ?? card.basePrice),
      };
    }),
  };
}
