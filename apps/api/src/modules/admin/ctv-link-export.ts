import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { formatVnDateTime } from '../../common/vn-time';
import { maskPhoneKeepLast3 } from '../../common/mask-pii';
import { attachLinkTargets, type LinkTargetInfo } from '../affiliate/affiliate-link-target';
import { EXPORT_BATCH, row, text } from './admin-export';

/**
 * File "Hoa hồng CTV theo link" cho kế toán đối soát: mỗi link CTV một dòng (lượt bấm, đơn, doanh số tính hoa hồng, hoa hồng theo trạng thái), và
 * mỗi người có hoa hồng ngoài link (gian hàng, mã giới thiệu, đơn đặt hộ, đơn trước khi có mã link trên đơn) thêm một dòng "Không qua link". Cộng
 * cột "Tổng hoa hồng" mọi dòng của một người ra đúng tổng hoa hồng còn hiệu lực của người đó. Số lũy kế tới lúc xuất, không theo khoảng ngày.
 *
 * Đơn và tiền đọc thẳng từ dòng hoa hồng chưa REJECTED (đơn huỷ/trả không tính), không đọc bộ đếm `affiliate_links.conversions`/`revenue`: bộ đếm
 * kẹp trần Int4 và lệch khi rollback image, còn dòng hoa hồng là sổ gốc. Lượt bấm chỉ có ở bộ đếm `affiliate_links.clicks`.
 */
export const CTV_LINK_CSV_HEADERS = [
  'Mã người dùng',
  'Mã giới thiệu',
  'Tên CTV',
  'SĐT CTV',
  'Vai trò',
  'Mã link',
  'Đích link',
  'Ngày tạo link',
  'Lượt bấm',
  'Số đơn',
  'Doanh số tính hoa hồng (VNĐ)',
  'HH đơn chưa giao (VNĐ)',
  'HH đang giữ sau giao (VNĐ)',
  'HH đã duyệt chờ chi (VNĐ)',
  'HH đã chi (VNĐ)',
  'Tổng hoa hồng trước thuế (VNĐ)',
];

export const NO_LINK_TARGET_LABEL = 'Không qua link (gian hàng, mã giới thiệu, đơn đặt hộ)';

const ROLE_LABEL: Record<string, string> = {
  AFFILIATE: 'CTV',
  DEALER: 'Đại lý',
  CUSTOMER: 'Khách hàng',
  STAFF: 'Nhân viên',
  ADMIN: 'Quản trị',
};

const TARGET_LABEL: Record<string, string> = {
  HOMEPAGE: 'Trang chủ',
  DEAL: 'Giờ vàng',
  PRODUCT: 'Sản phẩm',
  CATEGORY: 'Danh mục',
  CAMPAIGN: 'Chiến dịch',
  COMBO: 'Bộ quà tặng',
};

/** Tên đích link như CTV thấy; sản phẩm/danh mục/chiến dịch đã xoá, ngừng bán hoặc hết hạn ghi rõ để kế toán không đi tìm. */
export function linkTargetText(l: { targetType: string } & Pick<LinkTargetInfo, 'targetLabel' | 'targetAvailable'>): string {
  const kind = TARGET_LABEL[l.targetType] ?? l.targetType;
  if (l.targetType !== 'PRODUCT' && l.targetType !== 'CATEGORY' && l.targetType !== 'CAMPAIGN') return kind;
  if (!l.targetLabel) return `${kind}: (đã xoá)`;
  const gone = l.targetType === 'CAMPAIGN' ? ' (đã tắt hoặc kết thúc)' : ' (ngừng bán)';
  return `${kind}: ${l.targetLabel}${l.targetAvailable ? '' : gone}`;
}

const LIVE_STATUSES = ['PENDING', 'LOCKED', 'APPROVED', 'PAID'] as const;
type LiveStatus = (typeof LIVE_STATUSES)[number];
const isLive = (s: string): s is LiveStatus => (LIVE_STATUSES as readonly string[]).includes(s);

type Tally = { orders: number; base: number } & Record<LiveStatus, number>;
const emptyTally = (): Tally => ({ orders: 0, base: 0, PENDING: 0, LOCKED: 0, APPROVED: 0, PAID: 0 });

interface CommissionAggRow {
  user_id: string;
  link_code: string | null;
  status: string;
  n: number;
  base: bigint | number | null;
  amount: bigint | number | null;
}

/** Khoá gộp: mã link (thuộc đúng người hưởng) hoặc rỗng = không qua link. */
const tallyKey = (userId: string, linkCode: string | null) => `${userId} ${linkCode ?? ''}`;

async function userIdBatch(prisma: PrismaService, cursor: string | undefined): Promise<string[]> {
  const after = cursor ? Prisma.sql`WHERE u.id > ${cursor}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u.id FROM (
      SELECT "userId" AS id FROM affiliate_links
      UNION
      SELECT "affiliateUserId" AS id FROM commissions
    ) u
    ${after}
    ORDER BY u.id
    LIMIT ${EXPORT_BATCH}`);
  return rows.map((r) => r.id);
}

/** Hoa hồng chưa REJECTED của cả lô người, gộp theo (người, link của đúng người đó hoặc không link, trạng thái). */
async function commissionTallies(prisma: PrismaService, userIds: string[]): Promise<Map<string, Tally>> {
  const rows = await prisma.$queryRaw<CommissionAggRow[]>(Prisma.sql`
    SELECT c."affiliateUserId" AS user_id,
           l."shortCode" AS link_code,
           c.status::text AS status,
           COUNT(*)::int AS n,
           COALESCE(SUM(c."commissionableTotal"), 0)::bigint AS base,
           COALESCE(SUM(c.amount), 0)::bigint AS amount
      FROM commissions c
      JOIN orders o ON o.id = c."orderId"
      LEFT JOIN affiliate_links l ON l."shortCode" = o."affiliateLinkCode" AND l."userId" = c."affiliateUserId"
     WHERE c."affiliateUserId" IN (${Prisma.join(userIds)})
       AND c.status <> 'REJECTED'
     GROUP BY c."affiliateUserId", l."shortCode", c.status`);
  const out = new Map<string, Tally>();
  for (const r of rows) {
    if (!isLive(r.status)) continue;
    const key = tallyKey(r.user_id, r.link_code);
    const t = out.get(key) ?? emptyTally();
    t.orders += r.n;
    t.base += Number(r.base ?? 0);
    t[r.status] += Number(r.amount ?? 0);
    out.set(key, t);
  }
  return out;
}

const tallyCells = (t: Tally) => [t.orders, t.base, t.PENDING, t.LOCKED, t.APPROVED, t.PAID, t.PENDING + t.LOCKED + t.APPROVED + t.PAID];

/**
 * Đọc theo lô người (mã người tăng dần, `EXPORT_BATCH` người mỗi lô): mỗi lô ba truy vấn gom (người, link, hoa hồng) và tối đa hai truy vấn tên
 * đích. Trong một người: các link theo ngày tạo, rồi dòng "Không qua link" nếu có. `maskPhones`: người xuất không thấy SĐT đầy đủ
 * (seesFullOrderPhones) chỉ nhận 3 số cuối của SĐT CTV.
 */
export async function* ctvLinkCsvChunks(prisma: PrismaService, opts: { maskPhones?: boolean } = {}): AsyncGenerator<string> {
  yield row(CTV_LINK_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const ids = await userIdBatch(prisma, cursor);
    if (ids.length === 0) return;
    const [users, links, tallies] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phone: true, referralCode: true, role: true } }),
      prisma.affiliateLink.findMany({
        where: { userId: { in: ids } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { userId: true, shortCode: true, targetType: true, targetId: true, clicks: true, createdAt: true },
      }),
      commissionTallies(prisma, ids),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const withTargets = await attachLinkTargets(prisma, links);
    const linksByUser = new Map<string, typeof withTargets>();
    for (const l of withTargets) {
      const list = linksByUser.get(l.userId) ?? [];
      list.push(l);
      linksByUser.set(l.userId, list);
    }
    let out = '';
    for (const id of ids) {
      const u = userById.get(id);
      const person = [
        text(id),
        text(u?.referralCode),
        u?.fullName ?? '',
        text(opts.maskPhones ? maskPhoneKeepLast3(u?.phone) : u?.phone),
        u ? (ROLE_LABEL[u.role] ?? u.role) : '',
      ];
      for (const l of linksByUser.get(id) ?? []) {
        const t = tallies.get(tallyKey(id, l.shortCode)) ?? emptyTally();
        out += row([...person, text(l.shortCode), linkTargetText(l), formatVnDateTime(l.createdAt), l.clicks, ...tallyCells(t)]);
      }
      const noLink = tallies.get(tallyKey(id, null));
      if (noLink) out += row([...person, '', NO_LINK_TARGET_LABEL, '', '', ...tallyCells(noLink)]);
    }
    if (out) yield out;
    if (ids.length < EXPORT_BATCH) return;
    cursor = ids[ids.length - 1];
  }
}
