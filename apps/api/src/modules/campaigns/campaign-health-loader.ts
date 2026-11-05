import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { normalizeCouponCode } from '../coupons/coupons.service';
import { isPublicProduct } from '../catalog/public-product';
import { hasServedImagePrefix } from '../../common/served-image';
import { bannerLinkUsable } from './campaign-public';
import { campaignHealth, PeerIndex, usableCounts, type HealthCoupon, type HealthIssue, type HealthProduct, type HealthSubject } from './campaign-health';

type HealthPrisma = Pick<PrismaService, '$queryRaw' | 'campaign' | 'campaignProduct' | 'campaignCoupon' | 'product' | 'coupon' | 'category'>;

export interface HealthRequest {
  subject: HealthSubject;
  /** Id sản phẩm đang soạn; bỏ trống thì đọc từ liên kết đã lưu của `subject.id`. */
  productIds?: readonly string[];
  /** Mã đang soạn; bỏ trống thì đọc từ liên kết đã lưu của `subject.id`. */
  couponCodes?: readonly string[];
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  approvalStatus: true,
  variations: { select: { isActive: true, stock: true } },
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

const COUPON_SELECT = { code: true, isActive: true, startAt: true, endAt: true, usageLimit: true, usedCount: true } satisfies Prisma.CouponSelect;

// Trần an toàn cho số chiến dịch bật cùng nạp để tính chồng banner (danh sách admin cũng chỉ lấy tối đa 200 dòng).
const PEER_LIMIT = 500;

const toProduct = (p: ProductRow): HealthProduct => ({
  name: p.name,
  visible: isPublicProduct(p),
  inStock: p.variations.some((v) => v.isActive && v.stock > 0),
});

const unique = <T>(items: readonly T[]) => [...new Set(items)];

export interface HealthDetail {
  issues: HealthIssue[];
  usable: { products: number; coupons: number };
}

/**
 * Kiểm sức khoẻ nhiều chiến dịch bằng số truy vấn cố định (tối đa 8, không phụ thuộc số chiến dịch): liên kết sản phẩm, liên kết mã, sản phẩm đang soạn,
 * mã đang soạn, đích sản phẩm, đích danh mục, chiến dịch bật cùng vị trí, và (chỉ khi có chiến dịch khác) đầu ảnh của chúng để biết cái nào thật sự ra slide. Thứ tự kết quả theo thứ tự `requests`.
 */
export async function campaignHealthBatch(prisma: HealthPrisma, requests: readonly HealthRequest[], now: Date): Promise<HealthIssue[][]> {
  return (await campaignHealthDetailBatch(prisma, requests, now)).map((d) => d.issues);
}

export async function campaignHealthDetailBatch(prisma: HealthPrisma, requests: readonly HealthRequest[], now: Date): Promise<HealthDetail[]> {
  // Đã kết thúc thì không có gì để tra: bỏ khỏi mọi truy vấn (campaignHealth tự trả riêng ENDED).
  const live = requests.filter((r) => r.subject.endAt > now);
  const none = (r: HealthRequest): HealthDetail => {
    const facts = { now, target: null, products: [], coupons: [], peers: [] };
    return { issues: campaignHealth(r.subject, facts), usable: usableCounts(r.subject, facts) };
  };
  if (live.length === 0) return requests.map(none);

  const savedProductIds = unique(live.filter((r) => r.productIds === undefined && r.subject.id).map((r) => r.subject.id as string));
  const savedCouponIds = unique(live.filter((r) => r.couponCodes === undefined && r.subject.id).map((r) => r.subject.id as string));
  const draftProductIds = unique(live.flatMap((r) => r.productIds ?? []));
  const draftCodes = unique(live.flatMap((r) => (r.couponCodes ?? []).map(normalizeCouponCode)).filter((c) => c !== ''));
  const productSlugs = unique(live.filter((r) => r.subject.linkType === 'PRODUCT' && r.subject.linkValue).map((r) => r.subject.linkValue as string));
  const categorySlugs = unique(live.filter((r) => r.subject.linkType === 'CATEGORY' && r.subject.linkValue).map((r) => r.subject.linkValue as string));
  const placements = unique(live.map((r) => r.subject.placement));

  const [savedProducts, savedCoupons, draftProducts, draftCoupons, targetProducts, targetCategories, peerRows] = await Promise.all([
    savedProductIds.length
      ? prisma.campaignProduct.findMany({ where: { campaignId: { in: savedProductIds } }, select: { campaignId: true, product: { select: PRODUCT_SELECT } } })
      : [],
    savedCouponIds.length
      ? prisma.campaignCoupon.findMany({ where: { campaignId: { in: savedCouponIds } }, select: { campaignId: true, coupon: { select: COUPON_SELECT } } })
      : [],
    draftProductIds.length ? prisma.product.findMany({ where: { id: { in: draftProductIds } }, select: PRODUCT_SELECT }) : [],
    draftCodes.length ? prisma.coupon.findMany({ where: { code: { in: draftCodes } }, select: COUPON_SELECT }) : [],
    productSlugs.length ? prisma.product.findMany({ where: { slug: { in: productSlugs } }, select: PRODUCT_SELECT }) : [],
    categorySlugs.length ? prisma.category.findMany({ where: { slug: { in: categorySlugs } }, select: { slug: true } }) : [],
    prisma.campaign.findMany({
      where: { isActive: true, endAt: { gt: now }, placement: { in: placements } },
      select: { id: true, placement: true, audience: true, startAt: true, endAt: true, sortOrder: true, linkType: true, linkValue: true },
      take: PEER_LIMIT,
    }),
  ]);

  // Ảnh banner có ra được slide không: chỉ lấy 32 ký tự đầu (ảnh base64 tới ~1,5 MB mỗi chiến dịch; `left` không buộc Postgres đọc trọn TOAST) rồi phân loại
  // bằng tiền tố ảnh raster dùng chung với endpoint ảnh. Tiền tố hợp lệ mà thân base64 hỏng vẫn tính là ra slide (hiếm; chỉ thừa một cảnh báo CROWDED).
  const heads = peerRows.length
    ? await prisma.$queryRaw<{ id: string; head: string }[]>`SELECT "id", left("image", 32) AS "head" FROM "campaigns" WHERE "id" IN (${Prisma.join(peerRows.map((p) => p.id))})`
    : [];
  const unservable = new Set(heads.filter((h) => h.head === '' || (h.head.startsWith('data:') && !hasServedImagePrefix(h.head))).map((h) => h.id));
  const peerFacts = peerRows.map(({ linkType, linkValue, ...p }) => ({ ...p, shows: !unservable.has(p.id) && bannerLinkUsable({ linkType, linkValue }) }));

  const peerIndexByPlacement = new Map<string, { peers: typeof peerFacts; index: PeerIndex }>();
  for (const placement of placements) {
    const peers = peerFacts.filter((p) => p.placement === placement);
    peerIndexByPlacement.set(placement, { peers, index: new PeerIndex(peers) });
  }

  const productsByCampaign = new Map<string, HealthProduct[]>();
  for (const l of savedProducts) productsByCampaign.set(l.campaignId, [...(productsByCampaign.get(l.campaignId) ?? []), toProduct(l.product)]);
  const couponsByCampaign = new Map<string, HealthCoupon[]>();
  for (const l of savedCoupons) couponsByCampaign.set(l.campaignId, [...(couponsByCampaign.get(l.campaignId) ?? []), l.coupon]);
  const draftProductById = new Map(draftProducts.map((p) => [p.id, toProduct(p)]));
  const draftCouponByCode = new Map(draftCoupons.map((c) => [c.code, c as HealthCoupon]));
  const targetProductBySlug = new Map(targetProducts.map((p) => [p.slug, p]));
  const categorySet = new Set(targetCategories.map((c) => c.slug));

  return requests.map((r) => {
    const s = r.subject;
    const products = r.productIds
      ? r.productIds.map((id) => draftProductById.get(id)).filter((p): p is HealthProduct => p !== undefined)
      : (productsByCampaign.get(s.id ?? '') ?? []);
    const coupons = r.couponCodes
      ? unique(r.couponCodes.map(normalizeCouponCode)).map((c) => draftCouponByCode.get(c)).filter((c): c is HealthCoupon => c !== undefined)
      : (couponsByCampaign.get(s.id ?? '') ?? []);
    let target: { exists: boolean; visible: boolean } | null = null;
    if (s.linkType === 'PRODUCT') {
      const p = s.linkValue ? targetProductBySlug.get(s.linkValue) : undefined;
      target = { exists: p !== undefined, visible: p !== undefined && isPublicProduct(p) };
    } else if (s.linkType === 'CATEGORY') {
      const exists = s.linkValue ? categorySet.has(s.linkValue) : false;
      target = { exists, visible: exists };
    }
    if (s.endAt <= now) return none(r);
    const facts = { now, target, products, coupons, ...(peerIndexByPlacement.get(s.placement) ?? { peers: [], index: new PeerIndex([]) }) };
    return { issues: campaignHealth(s, facts), usable: usableCounts(s, facts) };
  });
}
