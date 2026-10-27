import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PHONE_LIKE_RUN } from '../../common/mask-pii';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';
import { templateVariableProblem, variablesOf, type TemplateVariable } from './notification-variables';

/**
 * Kênh gửi thật của một template, theo đúng điều kiện ở NotificationsService.notify(): ZNS chỉ gửi
 * khi template là kênh ZNS VÀ có zaloTemplateId; còn lại khách chỉ thấy bản INAPP khi mở app.
 */
export type TemplateDelivery = 'ZNS' | 'ZNS_MISSING_TEMPLATE_ID' | 'INAPP';

export interface AdminNotificationTemplate {
  id: string;
  code: string;
  channel: string;
  zaloTemplateId: string | null;
  bodyTemplate: string;
  delivery: TemplateDelivery;
  /** INAPP: mọi bản ghi trong app; ZNS: chỉ lượt Zalo xác nhận đã nhận (error === 0). */
  sent30d: { INAPP: number; ZNS: number };
  /** Lượt ZNS 30 ngày gần nhất bị từ chối/lỗi hẳn, kèm mã + lý do của lần gần nhất để admin biết phải sửa gì. */
  znsFailed30d: number;
  znsLastError: { text: string; at: Date } | null;
  /** Nhân viên Marketing sửa được nội dung mẫu này (MARKETING_TEMPLATE_CODES). */
  staffEditable: boolean;
  /** Biến mã thật sự điền cho mẫu này; null = mẫu ngoài danh sách, không kiểm được. */
  variables: TemplateVariable[] | null;
}

/**
 * Mẫu khuyến mãi / tương tác nhân viên Marketing sửa được nội dung (D1-05). Mẫu đơn hàng, hoàn tiền, hoa hồng, đối tác,
 * vận hành chỉ quản trị viên sửa: tin đó khách và đối tác tin là lời Tubu về tiền, sửa thành "chuyển khoản vào STK…" là
 * lừa đảo bằng kênh chính thức. Mẫu mới mặc định không có ở đây.
 */
export const MARKETING_TEMPLATE_CODES: ReadonlySet<string> = new Set([
  'WELCOME_VOUCHER',
  'BIRTHDAY_VOUCHER',
  'WINBACK_VOUCHER',
  'SECOND_ORDER_VOUCHER',
  'MILESTONE_VOUCHER',
  'VOUCHER_EXPIRING',
  'FLASH_STARTING',
  'CART_ABANDONED',
  'PRICE_DROP_ALERT',
  'REORDER_REMINDER',
  'REVIEW_REQUEST',
  'POINTS_EXPIRING',
  'GAME_CHECKIN_REMINDER',
  'GAME_TREE_THIRSTY',
  'GAME_WATER_GIFT',
  'STOREFRONT_TRENDING_PRODUCTS',
  'COMMUNITY_NEW_ANSWER',
  'COMMUNITY_EXPERT_REPLIED',
  'COMMUNITY_BEST_ANSWER',
  'COMMUNITY_POST_APPROVED',
  'COMMUNITY_POST_REJECTED',
  'COMMUNITY_POST_LIKED',
  'COMMUNITY_POST_COMMENTED',
  'COMMUNITY_POST_HIDDEN',
]);

const DELIVERY_ORDER: Record<TemplateDelivery, number> = { ZNS_MISSING_TEMPLATE_ID: 0, ZNS: 1, INAPP: 2 };
/** template_id ZNS do Zalo cấp là một dãy số. */
const ZNS_TEMPLATE_ID = /^\d{1,20}$/;

/**
 * Admin sửa NotificationTemplate (kênh, mã mẫu ZNS đã được Zalo duyệt, nội dung in-app). Trước đây
 * không có đường nào ngoài sửa DB/seed, nên mẫu ZNS duyệt xong vẫn không bật được và mọi thông
 * báo chỉ nằm trong app.
 */
@Injectable()
export class NotificationTemplatesAdminService {
  private readonly logger = new Logger(NotificationTemplatesAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly env?: ConfigService,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  async list(now: Date = new Date()): Promise<AdminNotificationTemplate[]> {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [templates, counts, failures] = await Promise.all([
      this.prisma.notificationTemplate.findMany(),
      this.prisma.notificationLog.groupBy({
        by: ['templateCode', 'channel', 'status'],
        where: { sentAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.notificationLog.findMany({
        where: { channel: 'ZNS', status: 'FAILED', sentAt: { gte: since } },
        orderBy: { sentAt: 'desc' },
        distinct: ['templateCode'],
        select: { templateCode: true, error: true, sentAt: true },
      }),
    ]);
    const sent = new Map<string, { INAPP: number; ZNS: number }>();
    const failed = new Map<string, number>();
    for (const c of counts) {
      const n = typeof c._count === 'object' ? (c._count._all ?? 0) : 0;
      if (c.channel === 'ZNS' && c.status === 'FAILED') failed.set(c.templateCode, (failed.get(c.templateCode) ?? 0) + n);
      const row = sent.get(c.templateCode) ?? { INAPP: 0, ZNS: 0 };
      if (c.channel === 'INAPP') row.INAPP += n;
      // Chỉ SENT mới là Zalo đã nhận; PENDING/RETRYING đang chờ, FAILED đếm riêng ở znsFailed30d.
      if (c.channel === 'ZNS' && c.status === 'SENT') row.ZNS += n;
      sent.set(c.templateCode, row);
    }
    const lastError = new Map(failures.map((f) => [f.templateCode, { text: f.error ?? 'Không rõ lý do', at: f.sentAt }]));
    return templates
      .map((t) => ({
        ...t,
        delivery: deliveryOf(t),
        sent30d: sent.get(t.code) ?? { INAPP: 0, ZNS: 0 },
        znsFailed30d: failed.get(t.code) ?? 0,
        znsLastError: lastError.get(t.code) ?? null,
        staffEditable: MARKETING_TEMPLATE_CODES.has(t.code),
        variables: variablesOf(t.code),
      }))
      .sort(
        (a, b) =>
          DELIVERY_ORDER[a.delivery] - DELIVERY_ORDER[b.delivery] ||
          b.znsFailed30d - a.znsFailed30d ||
          b.sent30d.INAPP + b.sent30d.ZNS - (a.sent30d.INAPP + a.sent30d.ZNS) ||
          a.code.localeCompare(b.code),
      );
  }

  async update(code: string, dto: UpdateNotificationTemplateDto, actor: { id: string; staff: boolean } = { id: 'system', staff: false }) {
    const current = await this.prisma.notificationTemplate.findUnique({ where: { code } });
    if (!current) throw new NotFoundException('Không tìm thấy mẫu thông báo.');
    if (actor.staff) {
      assertStaffMayEdit(current, dto);
      if (dto.bodyTemplate !== undefined) assertStaffBody(dto.bodyTemplate, await this.shopLinks());
    }

    const data: { channel?: string; zaloTemplateId?: string | null; bodyTemplate?: string } = {};
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.zaloTemplateId !== undefined) {
      const id = dto.zaloTemplateId?.trim() ?? '';
      if (id && !ZNS_TEMPLATE_ID.test(id)) {
        throw new BadRequestException('Mã mẫu ZNS là dãy số Zalo cấp khi duyệt mẫu (vd 231570).');
      }
      data.zaloTemplateId = id || null;
    }
    if (dto.bodyTemplate !== undefined) {
      const body = dto.bodyTemplate.trim();
      if (!body) throw new BadRequestException('Nội dung thông báo không được để trống.');
      const problem = templateVariableProblem(code, body);
      if (problem) throw new BadRequestException(problem);
      data.bodyTemplate = body;
    }

    const channel = data.channel ?? current.channel;
    const templateId = data.zaloTemplateId !== undefined ? data.zaloTemplateId : current.zaloTemplateId;
    // Chỉ kiểm khi lần sửa này đổi kênh / mã mẫu: sửa nội dung một mẫu ZNS đang thiếu mã mẫu không bị kẹt.
    const deliveryChanged = channel !== current.channel || templateId !== current.zaloTemplateId;
    if (deliveryChanged && channel === 'ZNS' && !templateId) {
      throw new BadRequestException('Kênh ZNS cần mã mẫu đã được Zalo duyệt. Nhập mã mẫu hoặc để kênh Trong app.');
    }
    const updated = await this.prisma.notificationTemplate.update({ where: { code }, data });
    this.logger.warn(`${actor.staff ? 'Nhân viên' : 'Admin'} ${actor.id} sửa mẫu thông báo ${code}: ${JSON.stringify(data)}`);
    return updated;
  }

  /** Link của shop được phép trong nội dung nhân viên sửa: Zalo OA (ZALO_OA_ID) và Mini App (app.miniapp_base_url). */
  private async shopLinks(): Promise<ShopLinks> {
    const oaId = this.env?.get<string>('ZALO_OA_ID')?.trim() || null;
    const raw: unknown = await this.config?.get<string>('app.miniapp_base_url', '');
    const miniApp = typeof raw === 'string' && raw.trim() ? stripScheme(raw.trim()).replace(/\/+$/, '') : null;
    return { oaId, miniApp };
  }
}

/** Nhân viên chỉ sửa nội dung mẫu khuyến mãi; đổi kênh / mã mẫu ZNS là chi phí gửi tin, quản trị viên quyết. */
function assertStaffMayEdit(
  current: { code: string; channel: string; zaloTemplateId: string | null },
  dto: UpdateNotificationTemplateDto,
): void {
  if (!MARKETING_TEMPLATE_CODES.has(current.code)) {
    throw new ForbiddenException('Mẫu thông báo đơn hàng, tiền, đối tác và vận hành chỉ quản trị viên sửa.');
  }
  const channelChanged = dto.channel !== undefined && dto.channel !== current.channel;
  const idChanged = dto.zaloTemplateId !== undefined && (dto.zaloTemplateId?.trim() || null) !== current.zaloTemplateId;
  if (channelChanged || idChanged) {
    throw new ForbiddenException('Đổi kênh gửi hoặc mã mẫu ZNS (tính phí mỗi tin) chỉ quản trị viên làm.');
  }
}


interface ShopLinks {
  oaId: string | null;
  miniApp: string | null;
}

const SCHEME_LINK = /(?:https?:[/\\]*|www\.)\S+/giu;
const BARE_DOMAIN = /(?<![\p{L}\p{N}_@.\-/\\])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?/giu;
const PLACEHOLDER = /\{\{[^{}]*\}\}/g;
/** Đuôi tên miền hay gặp ở link rút gọn / lừa đảo: tên miền trần không có đường dẫn chỉ tính là link khi có đuôi này (để "Tp.HCM" không bị chặn). */
const COMMON_TLDS = new Set(
  (
    'com net org info biz vn io ly me co cc xyz top site online shop store app dev link click live pro asia tk ml ga cf gq ' +
    'ru cn us uk de fr jp kr sg th id my ph in ai gg to tv ws so pw fun icu vip win bid club life today world space website ' +
    'tech page one cloud digital email name mobi'
  ).split(' '),
);
const TRAILING_PUNCT = /[),.;:!?'"]+$/u;
const TUBUTREE_HOST = /(^|\.)tubutree\.(com|vn|com\.vn)$/i;

const stripScheme = (url: string) => url.replace(/^https?:\/*/i, '').replace(/^www\./i, '');

/** Mọi chuỗi dạng link trong nội dung: có scheme / www., hoặc tên miền trần (`bit.ly/abc`). Biến `{{key}}` không phải link. */
function linkTokens(text: string): string[] {
  const blank = (m: string) => ' '.repeat(m.length);
  let rest = text.replace(PLACEHOLDER, blank);
  const out: string[] = [];
  for (const re of [SCHEME_LINK, BARE_DOMAIN]) {
    for (const m of rest.matchAll(re)) {
      const t = m[0].replace(TRAILING_PUNCT, '');
      if (t && (re === SCHEME_LINK || /[/?#:]/.test(t) || COMMON_TLDS.has(t.split('.').pop()!.toLowerCase()))) out.push(t);
    }
    rest = rest.replace(re, blank);
  }
  return out;
}

/**
 * Link của shop: tubutree.com|vn|com.vn, Zalo OA (`zalo.me/<ZALO_OA_ID>`) và Mini App (`app.miniapp_base_url`). Trả mã số
 * định danh của OA / Mini App trong link (để không tính vào dãy chữ số), chuỗi rỗng nếu là link tubutree, null nếu không phải
 * link shop. Host đọc bằng URL; có `\` trong phần host thì không nhận.
 */
function shopLinkId(token: string, shop: ShopLinks): string | null {
  const url = /^https?:/i.test(token) ? token : `https://${token}`;
  const authority = url.replace(/^https?:[/\\]*/i, '').split(/[/?#]/, 1)[0]!;
  if (authority.includes('\\')) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (TUBUTREE_HOST.test(host)) return '';
  if (host !== 'zalo.me') return null;
  const first = u.pathname.split('/')[1] ?? '';
  if (shop.oaId && first === shop.oaId) return shop.oaId;
  const where = `${host}${u.pathname}`;
  if (shop.miniApp && (where === shop.miniApp || where.startsWith(`${shop.miniApp}/`))) return shop.miniApp.split('/').pop() ?? '';
  return null;
}

/**
 * Nội dung nhân viên sửa không được mang link ngoài tubutree và OA / Mini App của shop, hay số tài khoản / SĐT (dãy từ 8
 * chữ số, kể cả viết tách hay nằm trong query của link): tin gửi từ kênh chính thức, khách tin là lời Tubu. Chuẩn hoá NFKC
 * trước (chữ số, chữ toàn chiều rộng thành ASCII).
 */
function assertStaffBody(body: string, shop: ShopLinks): void {
  const text = body.normalize('NFKC');
  let digits = text;
  for (const token of linkTokens(text)) {
    const id = shopLinkId(token, shop);
    if (id === null) {
      throw new BadRequestException(`Nội dung chỉ được có link tubutree hoặc Zalo OA / Mini App của shop — bỏ link "${token}".`);
    }
    if (id) digits = digits.split(token).join(token.replace(id, ''));
  }
  if (PHONE_LIKE_RUN.test(digits)) {
    throw new BadRequestException(
      'Nội dung không được có dãy từ 8 chữ số trở lên (số tài khoản, số điện thoại), kể cả viết tách. Thông tin chuyển khoản chỉ quản trị viên đưa vào mẫu.',
    );
  }
}

function deliveryOf(t: { channel: string; zaloTemplateId: string | null }): TemplateDelivery {
  if (t.channel !== 'ZNS') return 'INAPP';
  return t.zaloTemplateId ? 'ZNS' : 'ZNS_MISSING_TEMPLATE_ID';
}
