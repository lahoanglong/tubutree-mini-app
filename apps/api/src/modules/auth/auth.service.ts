import { ConflictException, Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser, JwtPayload, LoginResponse } from '@tubutree/shared-types';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isLockBusy, LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import type { Env } from '../../config/env.validation';
import { ZaloService } from './zalo.service';
import { RbacService } from '../staff/rbac/rbac.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { isAnonymized, renameMergedMilestones, resolveMergedUserId, revokeReferralRewardForReferee } from '../wallet/referral-reward';
import { roleClaims } from './session-state.service';
import { NotificationsService } from '../notifications/notifications.service';
import { sendReferralNotices, type ReferralNotice } from '../wallet/referral-notify';

/** Khoá advisory theo transaction của mọi lần gộp phiên khách (quy ước pg_advisory_xact_lock(hashtext(...)) của repo). */
export const GUEST_MERGE_LOCK_KEY = 'auth.merge_guest';

/** Số bước tối đa khi dò chuỗi người mời của tài khoản đích lúc gộp (xem bước 10 của mergeGuestInto). */
export const MERGE_ANCESTOR_CAP = 1000;

/**
 * Hạn của tx gộp phía Prisma: maxWait = chờ lấy kết nối pool, timeout = Prisma huỷ tx khi quá hạn. timeout KHÔNG cắt một câu
 * đang chờ khoá (P2028 chỉ tới khi câu đó trả về), nên tx gộp còn tự đặt lock_timeout/statement_timeout ở Postgres
 * (MERGE_LOCK_TIMEOUT, MERGE_STATEMENT_TIMEOUT): lần gộp xếp hàng sau một lần gộp chậm (khoá chung) hay sau một tx giữ dòng lâu
 * bỏ cuộc sau vài giây, trả kết nối pool, client nhận lỗi "đang bận, thử lại". Bình thường một lần gộp mất vài chục ms.
 */
const MERGE_TX_OPTIONS = { maxWait: 2_000, timeout: 5_000 } as const;
const MERGE_LOCK_TIMEOUT = '2s';
const MERGE_STATEMENT_TIMEOUT = '5s';
const MERGE_BUSY_MESSAGE = LOCK_BUSY_MESSAGE;

/** Lần gộp thua vì tranh khoá, thử lại là qua (tx đã rollback nên không đổi gì). */
export const isMergeBusy = isLockBusy;

/**
 * Thứ tự khoá dòng users khi gộp: người được mời trước người mời (cạnh a → b khi a.referredById = b, cả hai trong tập),
 * cùng chiều mọi đường thưởng/thu hồi giới thiệu (lockReferee rồi lockReferrer). Tập này trước gộp không có vòng (người
 * mời luôn có trước). Hoà thì theo id để hai lần gộp cùng chạm một dòng khoá cùng thứ tự.
 */
export function referralLockOrder(rows: { id: string; referredById: string | null }[]): string[] {
  const ids = new Set(rows.map((r) => r.id));
  const pending = new Map<string, number>([...ids].map((id) => [id, 0]));
  for (const r of rows) {
    if (r.referredById && ids.has(r.referredById) && r.referredById !== r.id) {
      pending.set(r.referredById, (pending.get(r.referredById) ?? 0) + 1);
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(([, n]) => n === 0).map(([id]) => id).sort();
    const next = ready[0] ?? [...pending.keys()].sort()[0]!;
    pending.delete(next);
    out.push(next);
    const parent = byId.get(next)?.referredById;
    if (parent && pending.has(parent)) pending.set(parent, (pending.get(parent) ?? 1) - 1);
  }
  return out;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly zalo: ZaloService,
    private readonly rbac: RbacService,
    // Optional: test dựng tay 5 tham số vẫn chạy, chỉ không báo người mời bị thu thưởng lúc gộp.
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Đăng nhập KHÁCH (guest) theo deviceId — dùng khi Zalo login chưa khả dụng
   * (app chưa kích hoạt -1401). Tạo/lấy user ổn định theo thiết bị để app chạy đầy đủ.
   * Khi Zalo login khả dụng, có thể nâng cấp guest → tài khoản Zalo qua phone-merge.
   */
  async loginAsGuest(deviceId: string, referralCode?: string): Promise<LoginResponse> {
    const guestKey = `guest_${deviceId}`;
    let user = await this.prisma.user.findUnique({ where: { zaloId: guestKey } });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            zaloId: guestKey,
            fullName: 'Khách',
            referralCode: await this.generateReferralCode(),
            referredById: await this.resolveReferrerId(referralCode),
          },
        });
      } catch (err) {
        // 2 request guest-login đồng thời cùng deviceId → P2002 trên zaloId; dùng lại
        // user vừa được request kia tạo thay vì làm rớt phiên đăng nhập hợp lệ.
        user = await this.recoverFromZaloIdConflict(err, guestKey);
      }
    }
    return this.issueTokens(user);
  }

  /** Luồng đăng nhập Mini App: verify token Zalo → upsert user (+ SĐT) → trả JWT. */
  async loginWithZaloMiniApp(
    code: string,
    accessToken: string,
    phoneToken?: string,
    referralCode?: string,
  ): Promise<LoginResponse> {
    // code hiện chưa cần đổi token server-side cho mini app (token đã do SDK cấp);
    // giữ tham số để mở rộng OAuth web sau này.
    void code;
    const info = await this.zalo.getUserInfo(accessToken);

    // Giải mã SĐT (nếu FE gửi kèm token getPhoneNumber). Không chặn login nếu lỗi.
    const phone = phoneToken
      ? await this.zalo.resolvePhoneNumber(phoneToken, accessToken)
      : null;

    let user = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });

    // Merge theo SĐT (spec §6.1): user web đăng ký bằng phone, chưa có zaloId →
    // gắn zaloId vào tài khoản đó để dùng chung điểm/đơn thay vì tạo tài khoản trùng.
    if (!user && phone) {
      const byPhone = await this.prisma.user.findUnique({ where: { phone } });
      if (byPhone && !byPhone.zaloId) {
        return this.issueTokens(
          await this.prisma.user.update({
            where: { id: byPhone.id },
            data: {
              zaloId: info.zaloId,
              fullName: byPhone.fullName ?? info.name,
              avatarUrl: byPhone.avatarUrl ?? info.avatar,
            },
          }),
        );
      }
    }

    if (!user) {
      const checkedPhone = await this.phoneIfFree(phone);
      try {
        user = await this.prisma.user.create({
          data: {
            zaloId: info.zaloId,
            fullName: info.name,
            avatarUrl: info.avatar,
            phone: checkedPhone,
            referralCode: await this.generateReferralCode(),
            referredById: await this.resolveReferrerId(referralCode),
          },
        });
      } catch (err) {
        // Phòng thủ race condition: 2 request đăng nhập đồng thời cùng SĐT → P2002. Fallback bỏ phone để không crash 409.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && checkedPhone) {
          try {
            user = await this.prisma.user.create({
              data: {
                zaloId: info.zaloId,
                fullName: info.name,
                avatarUrl: info.avatar,
                referralCode: await this.generateReferralCode(),
                referredById: await this.resolveReferrerId(referralCode),
              },
            });
          } catch (retryErr) {
            // Retry vẫn đụng — lần này chỉ có thể là zaloId (đã bỏ phone) do 2 request
            // đăng nhập đồng thời cùng tài khoản Zalo mới → dùng lại user vừa được tạo.
            user = await this.recoverFromZaloIdConflict(retryErr, info.zaloId);
          }
        } else {
          // P2002 không phải do phone (hoặc không có phone) → chỉ có thể là zaloId
          // (2 request đăng nhập đồng thời cùng tài khoản Zalo mới).
          user = await this.recoverFromZaloIdConflict(err, info.zaloId);
        }
      }
      return this.issueTokens(user);
    }

    // User Zalo đã tồn tại → đồng bộ tên/avatar + lưu SĐT lần đầu (nếu có).
    const data: { fullName?: string; avatarUrl?: string | null; phone?: string } = {};
    if (info.name && user.fullName !== info.name) {
      data.fullName = info.name;
      data.avatarUrl = info.avatar ?? user.avatarUrl;
    }
    if (phone && !user.phone) {
      const free = await this.phoneIfFree(phone, user.id);
      if (free) data.phone = free;
    }
    if (Object.keys(data).length > 0) {
      user = await this.prisma.user.update({ where: { id: user.id }, data });
    }

    return this.issueTokens(user);
  }

  /**
   * A7-01 (audit 2026-09): điểm gọi DUY NHẤT để "xin/đính SĐT" giữa một phiên ĐÃ đăng nhập
   * (kể cả khách) — checkout ensurePhone() và nâng cấp ngầm ở store/auth.ts restore(). Khác
   * loginWithZaloMiniApp(): luôn nhận `currentUserId` từ JWT của phiên ĐANG chạy (controller
   * lấy qua @CurrentUser(), không phải field client tự khai — nếu để client tự khai thì ai
   * cũng có thể "gộp" giỏ/điểm/đơn của một userId bất kỳ vào tài khoản của họ). Vì luôn biết
   * chính xác phiên hiện tại là ai, hàm này KHÔNG BAO GIỜ âm thầm trả token của một user khác
   * mà bỏ lại giỏ/địa chỉ/điểm của phiên cũ (đúng lỗi gốc của A7-01):
   *
   *  - Zalo trên máy xác nhận ĐÚNG danh tính đang có (kể cả gọi lại nhiều lần) → không có ai
   *    khác để đổi, chỉ gắn thêm SĐT nếu còn thiếu.
   *  - Phiên hiện tại là KHÁCH (`zaloId` dạng `guest_<deviceId>`) và chưa ai giữ zaloId Zalo
   *    vừa xác nhận → "nâng cấp" NGAY dòng khách hiện tại (đổi zaloId/tên/avatar, giữ nguyên
   *    id) — giỏ/địa chỉ/điểm/đơn tự động đúng vì vẫn cùng 1 id, không cần gộp, không rủi ro.
   *  - Phiên hiện tại là KHÁCH nhưng zaloId (hoặc SĐT) đó đã thuộc một user THẬT khác có từ
   *    trước → gộp dữ liệu giá trị/rủi ro cao nhất của khách (giỏ, sổ địa chỉ, số dư điểm (cả lô
   *    quy đổi không hết hạn)/ví/
   *    cashback + sổ giao dịch, lịch sử đơn) vào user đó rồi trả token của user đó.
   *  - Phiên hiện tại KHÔNG PHẢI khách (đã là Zalo thật) nhưng Zalo trên máy giờ lại là một
   *    danh tính KHÁC — gộp 2 tài khoản THẬT với nhau là quyết định nghiệp vụ lớn (số dư ví
   *    thật, đơn hàng của CẢ HAI bên); không tự quyết trong bản vá khẩn cấp này. An toàn hơn
   *    là từ chối rõ ràng, không âm thầm đổi danh tính (đúng lỗi A7-01 đang vá).
   */
  async ensurePhoneForCurrentUser(
    currentUserId: string,
    code: string,
    accessToken: string,
    phoneToken?: string,
  ): Promise<LoginResponse> {
    void code; // giữ tham số để đồng nhất với loginWithZaloMiniApp, mở rộng OAuth server-side sau này.
    const currentUser = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUserId } });
    const info = await this.zalo.getUserInfo(accessToken);
    const phone = phoneToken ? await this.zalo.resolvePhoneNumber(phoneToken, accessToken) : null;

    if (currentUser.zaloId === info.zaloId) {
      // Trường hợp tầm thường: đúng danh tính đang có → không có ai khác để gộp/đổi.
      return this.issueTokens(await this.attachPhoneIfMissing(currentUser, phone));
    }

    // Dòng khách đã gộp (access token cũ còn hạn) không phải khách: nâng cấp tại chỗ sẽ hồi sinh nó với mergedIntoId còn trỏ
    // tài khoản đích, mã giới thiệu của nó vẫn quy về đích.
    if (currentUser.mergedIntoId) return this.mergedSessionTokens(currentUser, info, phone);
    const isGuest = (currentUser.zaloId?.startsWith('guest_') ?? false) && !currentUser.zaloId?.includes('_merged_');
    if (!isGuest) throw this.zaloMismatch(currentUser, info.zaloId);

    const existingByZalo = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });
    if (existingByZalo) {
      // Chính dòng khách này vừa được một request song song nâng cấp tại chỗ (currentUser đọc
      // trước đó nên còn zaloId khách) — gộp vào chính nó sẽ đổi zaloId làm hỏng tài khoản.
      if (existingByZalo.id === currentUser.id) return this.issueTokens(existingByZalo);
      return this.issueTokens(await this.mergeGuestInto(currentUser, existingByZalo, info, phone));
    }
    if (phone) {
      const existingByPhone = await this.prisma.user.findUnique({ where: { phone } });
      if (existingByPhone && !existingByPhone.zaloId) {
        return this.issueTokens(await this.mergeGuestInto(currentUser, existingByPhone, info, phone));
      }
    }

    // Không ai giữ danh tính Zalo này → nâng cấp TẠI CHỖ chính dòng khách hiện tại thay vì
    // tạo user mới rồi gộp — giỏ/địa chỉ/điểm/đơn đã đúng sẵn vì cùng 1 id.
    const checkedPhone = await this.phoneIfFree(phone, currentUser.id);
    try {
      // Có điều kiện: một request song song có thể vừa gộp chính dòng khách này (đọc ở trên trước lúc nó commit). Nâng cấp
      // vô điều kiện sẽ ghi đè zaloId của dòng đã gộp mà mergedIntoId vẫn trỏ tài khoản đích.
      const upgraded = await this.prisma.user.updateMany({
        where: { id: currentUser.id, zaloId: currentUser.zaloId, mergedIntoId: null },
        data: {
          zaloId: info.zaloId,
          fullName: info.name,
          avatarUrl: info.avatar ?? currentUser.avatarUrl,
          ...(checkedPhone ? { phone: checkedPhone } : {}),
        },
      });
      const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: currentUser.id } });
      if (upgraded.count === 1 || fresh.zaloId === info.zaloId) return this.issueTokens(fresh);
      if (fresh.mergedIntoId) return this.mergedSessionTokens(fresh, info, phone);
      throw this.zaloMismatch(fresh, info.zaloId);
    } catch (err) {
      // Hai máy khách khác nhau cùng nâng cấp lên một tài khoản Zalo mới cùng lúc: máy thắng đã
      // giữ zaloId, máy thua gộp vào dòng đó thay vì trả 500.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const winner = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });
      if (!winner || winner.id === currentUser.id) throw err;
      return this.issueTokens(await this.mergeGuestInto(currentUser, winner, info, phone));
    }
  }

  /**
   * Phiên của một dòng khách đã gộp (access token cũ còn hạn, thường là client gửi lại ensurePhone sau lần gộp): đúng tài
   * khoản Zalo của tài khoản đích thì trả token của đích như lần gộp đầu; Zalo khác thì từ chối như mọi phiên không phải khách.
   */
  private async mergedSessionTokens(merged: User, info: { zaloId: string }, phone: string | null): Promise<LoginResponse> {
    const targetId = merged.mergedIntoId ? await resolveMergedUserId(this.prisma, merged.mergedIntoId) : null;
    const target = targetId ? await this.prisma.user.findUnique({ where: { id: targetId } }) : null;
    if (target && target.zaloId === info.zaloId) return this.issueTokens(await this.attachPhoneIfMissing(target, phone));
    throw this.zaloMismatch(merged, info.zaloId);
  }

  private zaloMismatch(user: User, zaloId: string): ConflictException {
    this.logger.warn(
      `ensurePhone: user ${user.id} (không phải phiên khách, zaloId=${user.zaloId}) ` +
        `đổi sang zaloId khác (${zaloId}) trên máy — từ chối gộp, giữ nguyên phiên hiện tại.`,
    );
    return new ConflictException(
      'Tài khoản Zalo trên máy hiện khác với phiên đang đăng nhập. Vui lòng đăng xuất rồi đăng nhập lại để tiếp tục.',
    );
  }

  /** Gắn SĐT nếu user chưa có và SĐT còn trống — dùng cho nhánh "đúng danh tính đang có". */
  private async attachPhoneIfMissing(user: User, phone: string | null): Promise<User> {
    if (!phone || user.phone) return user;
    const free = await this.phoneIfFree(phone, user.id);
    if (!free) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { phone: free } });
  }

  /**
   * Gộp guest → target (target đã tồn tại từ trước, khác dòng với guest): giỏ hàng, sổ địa chỉ,
   * đơn + yêu cầu đổi trả, gói định kỳ, lệnh rút, số dư điểm (cả lô quy đổi)/ví/cashback + sổ giao dịch, lượt
   * dùng coupon, suất flash sale, điểm danh, đánh giá, yêu thích/nhắc/theo dõi thương hiệu và (khi
   * target chưa chơi) dữ liệu game.
   *
   * Không được "thử rồi bắt P2002" trong interactive transaction: sau lỗi đầu tiên Postgres huỷ
   * cả transaction (25P02), COMMIT thành ROLLBACK và mọi lần gộp sau lặp lại y hệt → phiên khách
   * kẹt vĩnh viễn. Vì vậy mọi bảng có unique theo userId được xử lý dòng trùng TRƯỚC bằng câu SQL
   * tập hợp (đổi khoá / cộng dồn / để lại ở khách), rồi mới chuyển phần còn lại.
   *
   * Hai request gộp cùng lúc cho một khách: khoá dòng khách (FOR UPDATE) rồi đọc lại số dư
   * TRONG transaction; request đến sau thấy zaloId khách đã đổi thì không cộng lần nữa.
   *
   * Còn để lại ở dòng khách (quan hệ 1-1 hoặc ít giá trị, chưa có quyết định "bên nào thắng"):
   * staffProfile/communityProfile/affiliate/commission/dealer/feed/... và dòng trùng khoá với
   * target ở các bảng trên. Các bảng này không giữ tiền hay luồng đang chạy của khách; dòng khách
   * không bị xoá nên vẫn tra lại được nếu cần gộp tay.
   */
  private async mergeGuestInto(
    guest: User,
    target: User,
    info: { zaloId: string; name?: string; avatar?: string },
    phone: string | null,
  ): Promise<User> {
    const targetPhone = phone && !target.phone ? await this.phoneIfFree(phone, target.id) : undefined;
    let referralNotices: ReferralNotice[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      referralNotices = [];
      // Mọi lần gộp chạy nối tiếp nhau. Tập dòng users của hai lần gộp có thể chồng nhau (khách G2 mời khách G1, cả hai gộp
      // vào cùng T) và thứ tự người-được-mời-trước của mỗi lần chỉ nhất quán trong tập của chính nó ⇒ hai lần gộp xen kẽ có
      // thể khoá ngược chiều (40P01). Khoá chung chấp nhận được: gộp chỉ xảy ra một lần mỗi khách lúc đăng nhập Zalo, tx
      // ngắn. Khoá này chỉ xếp các lần gộp với nhau (đường khác không lấy nó); với trả hàng, huỷ đơn, đặt đơn và thưởng, chính
      // thứ tự khoá dòng bên dưới mới chống vòng chờ.
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${MERGE_LOCK_TIMEOUT}, true), set_config('statement_timeout', ${MERGE_STATEMENT_TIMEOUT}, true)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${GUEST_MERGE_LOCK_KEY}))`;
      // Thứ tự khoá như đường đảo tiền (yêu cầu trả → đơn → suất giờ vàng → users): khoá dòng khách trước rồi mới chuyển
      // đơn/yêu cầu trả thì đảo chiều với lần duyệt đang giữ yêu cầu + đơn và chờ ví/điểm của khách ⇒ 40P01 (UAT R6-SYNC-2).
      await tx.$queryRaw`SELECT "id" FROM "return_requests" WHERE "userId" = ${guest.id} ORDER BY "id" FOR NO KEY UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "userId" = ${guest.id} ORDER BY "id" FOR NO KEY UPDATE`;
      // Giỏ của khách (bước 1 xoá) và của target (nhận dòng của khách): đặt đơn khoá giỏ của người đặt trước mọi khoá khác rồi
      // mới chạm users. Gộp khoá users rồi mới xoá giỏ khách là chờ ngược chiều với lần khách đang đặt (40P01). Lần target
      // đang đặt chỉ dọn đúng các dòng nó đã đọc, nhưng bước 1 cộng dồn dòng khách trùng biến thể vào chính dòng đó: không chờ
      // giỏ của target thì phần cộng dồn bị xoá theo (r13-merge-checkout-lock.race-spec). FOR UPDATE: dòng giỏ của khách bị
      // xoá. Đổi lại gộp chờ cả lần target đang đặt (quá lock_timeout ⇒ 503 "đang bận").
      await tx.$queryRaw`SELECT "id" FROM "carts" WHERE "userId" IN (${guest.id}, ${target.id}) ORDER BY "id" FOR UPDATE`;
      // Suất giờ vàng đã mua (bước 6 cộng dồn vào dòng của target): huỷ/trả đơn của target hoàn suất rồi mới ghi users của target,
      // nên gộp khoá users trước rồi mới ghi dòng suất là chờ ngược chiều ⇒ 40P01 (merge-reversal-flash-lock.race-spec). Chỉ khoá
      // đúng các dòng bước 6 ghi (của khách, và của target trùng suất với khách), theo suất rồi khách: cùng chiều với lần
      // hoàn suất của huỷ/trả đơn (khoá theo id suất) và với checkout.
      await tx.$queryRaw`
        SELECT "id" FROM "flash_sale_purchases"
         WHERE "userId" = ${guest.id}
            OR ("userId" = ${target.id}
                AND "flashSaleItemId" IN (SELECT "flashSaleItemId" FROM "flash_sale_purchases" WHERE "userId" = ${guest.id}))
         ORDER BY "flashSaleItemId", "userId"
         FOR NO KEY UPDATE`;
      // Dòng users: khách, target và những người khách đã mời (đổi referredById ở bước 10), người được mời trước người mời
      // (referralLockOrder). Khoá target còn xếp hàng hai khách khác nhau cùng gộp vào một target để bước kiểm trùng bên
      // dưới thấy dòng của lần gộp trước. Cạnh theo người mời đã quy qua mergedIntoId, như lần cấp thưởng khoá người được
      // mời rồi người mời ĐÃ QUY (khách B còn trỏ khách A đã gộp vào T: cấp thưởng khoá B rồi T, gộp B vào T cũng phải vậy).
      const circle = await tx.$queryRaw<{ id: string; referredById: string | null }[]>`
        SELECT u."id", COALESCE(p."mergedIntoId", u."referredById") AS "referredById"
          FROM "users" u LEFT JOIN "users" p ON p."id" = u."referredById"
         WHERE u."id" IN (${guest.id}, ${target.id}) OR u."referredById" = ${guest.id}`;
      for (const id of referralLockOrder(circle)) {
        if (id === guest.id || id === target.id) await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${id} FOR NO KEY UPDATE`;
      }
      const lockedGuest = await tx.$queryRaw<
        {
          zaloId: string | null;
          pointsBalance: number;
          pointsConvertedBalance: number;
          walletBalance: number;
          cashbackPending: number;
        }[]
      >`SELECT "zaloId", "pointsBalance", "pointsConvertedBalance", "walletBalance", "cashbackPending"
          FROM "users" WHERE "id" = ${guest.id} FOR UPDATE`;
      const g = lockedGuest[0];
      if (!g || g.zaloId !== guest.zaloId || g.zaloId?.includes('_merged_')) {
        return tx.user.findUniqueOrThrow({ where: { id: target.id } });
      }
      // Target bị khoá hoặc vừa bị xoá (ẩn danh hoá) sau lúc tra ở ngoài: không đổ tiền/đơn của khách vào tài khoản chết.
      const lockedTarget = await tx.user.findUniqueOrThrow({ where: { id: target.id }, select: { isBlocked: true, metadata: true } });
      if (lockedTarget.isBlocked || isAnonymized(lockedTarget.metadata)) {
        throw new ConflictException('Tài khoản Zalo này đã bị khoá hoặc đã xoá, không thể gộp phiên khách vào. Vui lòng liên hệ hỗ trợ.');
      }
      const gid = guest.id;
      const tid = target.id;
      const mergedPrefix = `MERGED:${gid}:`;

      // 1) Giỏ hàng — dòng không trùng biến thể được REPARENT (giữ nguyên id, vì màn thanh toán
      //    có thể đã chọn sẵn `itemIds` trước khi ensurePhone() chạy); dòng trùng biến thể cộng dồn
      //    vào dòng của target rồi xoá dòng khách (unique [cartId, variationId]).
      const guestCart = await tx.cart.findUnique({ where: { userId: gid }, select: { id: true } });
      if (guestCart) {
        const targetCart = await tx.cart.upsert({ where: { userId: tid }, create: { userId: tid }, update: {} });
        await tx.$executeRaw`
          UPDATE "cart_items" t SET "quantity" = t."quantity" + g."quantity"
            FROM "cart_items" g
           WHERE t."cartId" = ${targetCart.id} AND g."cartId" = ${guestCart.id} AND g."variationId" = t."variationId"`;
        await tx.$executeRaw`
          DELETE FROM "cart_items" g
           WHERE g."cartId" = ${guestCart.id}
             AND EXISTS (SELECT 1 FROM "cart_items" t WHERE t."cartId" = ${targetCart.id} AND t."variationId" = g."variationId")`;
        await tx.cartItem.updateMany({ where: { cartId: guestCart.id }, data: { cartId: targetCart.id } });
        await tx.cart.delete({ where: { id: guestCart.id } });
      }

      // 2) Sổ địa chỉ — target đã có địa chỉ mặc định thì bỏ cờ mặc định của địa chỉ chuyển sang.
      const targetHasDefault = (await tx.address.count({ where: { userId: tid, isDefault: true } })) > 0;
      await tx.address.updateMany({
        where: { userId: gid },
        data: targetHasDefault ? { userId: tid, isDefault: false } : { userId: tid },
      });

      // 3) Đơn, yêu cầu đổi trả, cashback, lượt dùng coupon: không có unique theo userId.
      //    Chuyển lượt dùng coupon để perUserLimit tính cả lượt đã dùng ở phiên khách.
      await tx.order.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.returnRequest.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.cashbackClick.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.cashbackTransaction.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.couponRedemption.updateMany({ where: { userId: gid }, data: { userId: tid } });
      // Gói định kỳ phải theo địa chỉ đã chuyển ở bước 2 (subscriptions.service tạm dừng gói khi
      // address.userId !== sub.userId); lệnh rút bị từ chối hoàn tiền về payout.userId.
      await tx.subscription.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.payout.updateMany({ where: { userId: gid }, data: { userId: tid } });

      // 4) Điểm danh. Chuỗi tính từ dòng loyalty_check_ins có dayKey lớn nhất, nên chỉ chuyển
      //    ngày CŨ HƠN lần điểm danh gần nhất của target (target chưa từng điểm danh thì chuyển
      //    hết) — target không thừa hưởng chuỗi của khách. Ngày trùng/mới hơn ở lại khách (dayKey
      //    phải giữ định dạng ngày, không gắn tiền tố MERGED được).
      const movedCheckInDays = (
        await tx.$queryRaw<{ dayKey: string }[]>`
          UPDATE "loyalty_check_ins" g SET "userId" = ${tid}
           WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "loyalty_check_ins" t WHERE t."userId" = ${tid} AND t."dayKey" = g."dayKey")
             AND g."dayKey" < COALESCE((SELECT max(t."dayKey") FROM "loyalty_check_ins" t WHERE t."userId" = ${tid}), '9999-12-31')
          RETURNING g."dayKey"`
      ).map((r) => r.dayKey);

      // 5) Sổ điểm và sổ xu cũ (chỉ còn lịch sử, xu đã quy sang Điểm Xanh). Partial unique theo userId: điểm danh (userId, refId=ngày) WHERE
      //    refType='CHECKIN' và nhiệm vụ (userId, reason) WHERE refType='QUEST'. Dòng sổ CHECKIN
      //    chỉ giữ khoá ngày khi dòng điểm danh cùng ngày đã sang target ở bước 4; ngày ở lại khách
      //    thì dòng sổ đổi khoá thành MERGED:<guestId>:<ngày>. Nếu không, target có dòng sổ ngày D
      //    mà không có dòng điểm danh ngày D: màn điểm danh báo "chưa điểm danh" nhưng mọi lần bấm
      //    đều đụng unique sổ. Dòng QUEST trùng với target cũng đổi khoá như vậy. Giữ cả hai lượt
      //    đã cộng (Q-11), số dư bước 8 vẫn khớp tổng sổ.
      await tx.$executeRaw`
        UPDATE "points_transactions" g SET "refId" = ${mergedPrefix}::text || g."refId"
         WHERE g."userId" = ${gid} AND g."refType" = 'CHECKIN' AND g."refId" IS NOT NULL
           AND (g."refId" <> ALL(${movedCheckInDays}::text[])
                OR EXISTS (SELECT 1 FROM "points_transactions" t
                            WHERE t."userId" = ${tid} AND t."refType" = 'CHECKIN' AND t."refId" = g."refId"))`;
      await tx.$executeRaw`
        UPDATE "coin_transactions" g SET "reason" = ${mergedPrefix}::text || g."reason"
         WHERE g."userId" = ${gid} AND g."refType" = 'QUEST'
           AND EXISTS (SELECT 1 FROM "coin_transactions" t
                        WHERE t."userId" = ${tid} AND t."refType" = 'QUEST' AND t."reason" = g."reason")`;
      // PD-3: sổ điểm cũng có partial unique (userId, reason) WHERE refType='QUEST'.
      await tx.$executeRaw`
        UPDATE "points_transactions" g SET "reason" = ${mergedPrefix}::text || g."reason"
         WHERE g."userId" = ${gid} AND g."refType" = 'QUEST'
           AND EXISTS (SELECT 1 FROM "points_transactions" t
                        WHERE t."userId" = ${tid} AND t."refType" = 'QUEST' AND t."reason" = g."reason")`;
      await tx.pointsTransaction.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.coinTransaction.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await renameMergedMilestones(tx, gid, tid);

      // 6) Bảng giới hạn lượt theo user. Flash sale: cộng dồn số đã mua để perUserLimit tính cả
      //    hai bên. Đánh giá: mỗi lần mua (đơn) một đánh giá và đơn của khách đã sang target ở trên, nên đánh giá đi theo
      //    đơn của nó; trùng khoá (target, SP, đơn) thì giữ của target.
      await tx.$executeRaw`
        UPDATE "flash_sale_purchases" t SET "quantity" = t."quantity" + g."quantity", "updatedAt" = now()
          FROM "flash_sale_purchases" g
         WHERE t."userId" = ${tid} AND g."userId" = ${gid} AND g."flashSaleItemId" = t."flashSaleItemId"`;
      await tx.$executeRaw`
        DELETE FROM "flash_sale_purchases" g
         WHERE g."userId" = ${gid}
           AND EXISTS (SELECT 1 FROM "flash_sale_purchases" t WHERE t."userId" = ${tid} AND t."flashSaleItemId" = g."flashSaleItemId")`;
      await tx.flashSalePurchase.updateMany({ where: { userId: gid }, data: { userId: tid } });
      await tx.$executeRaw`
        UPDATE "reviews" g SET "userId" = ${tid}
         WHERE g."userId" = ${gid}
           AND NOT EXISTS (SELECT 1 FROM "reviews" t
                            WHERE t."userId" = ${tid} AND t."productId" = g."productId" AND t."orderId" = g."orderId")`;

      // Danh sách theo dõi/nhắc: unique (userId, khoá), trùng thì giữ dòng của target.
      await tx.$executeRaw`
        UPDATE "wishlists" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
           AND NOT EXISTS (SELECT 1 FROM "wishlists" t WHERE t."userId" = ${tid} AND t."productId" = g."productId")`;
      await tx.$executeRaw`
        UPDATE "flash_sale_reminders" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
           AND NOT EXISTS (SELECT 1 FROM "flash_sale_reminders" t
                            WHERE t."userId" = ${tid} AND t."flashSaleItemId" = g."flashSaleItemId")`;
      await tx.$executeRaw`
        UPDATE "brand_follows" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
           AND NOT EXISTS (SELECT 1 FROM "brand_follows" t WHERE t."userId" = ${tid} AND t."brandId" = g."brandId")`;
      await tx.$executeRaw`
        UPDATE "reorder_reminders" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
           AND NOT EXISTS (SELECT 1 FROM "reorder_reminders" t
                            WHERE t."userId" = ${tid} AND t."variationId" = g."variationId")`;

      // 7) Game: chỉ chuyển nguyên cụm khi target chưa có GameProfile (chưa từng chơi). Cả hai
      //    cùng chơi thì giữ game của target, cụm của khách ở lại — ghép hai khu vườn (ô đất,
      //    cấp cây, chuỗi tưới) cần quyết định riêng.
      const targetPlays = (await tx.gameProfile.count({ where: { userId: tid } })) > 0;
      if (!targetPlays) {
        await tx.gameProfile.updateMany({ where: { userId: gid }, data: { userId: tid } });
        await tx.plantedTree.updateMany({ where: { userId: gid }, data: { userId: tid } });
        await tx.gameSpin.updateMany({ where: { userId: gid }, data: { userId: tid } });
        await tx.$executeRaw`
          UPDATE "user_species" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "user_species" t WHERE t."userId" = ${tid} AND t."speciesId" = g."speciesId")`;
        await tx.$executeRaw`
          UPDATE "garden_plots" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "garden_plots" t WHERE t."userId" = ${tid} AND t."slot" = g."slot")`;
        await tx.$executeRaw`
          UPDATE "game_quiz_attempts" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "game_quiz_attempts" t
                              WHERE t."userId" = ${tid} AND t."quizId" = g."quizId" AND t."dayKey" IS NOT DISTINCT FROM g."dayKey")`;
        await tx.$executeRaw`
          UPDATE "mission_progress" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "mission_progress" t
                              WHERE t."userId" = ${tid} AND t."missionId" = g."missionId" AND t."cycleKey" = g."cycleKey")`;
        await tx.$executeRaw`
          UPDATE "user_season_passes" g SET "userId" = ${tid} WHERE g."userId" = ${gid}
             AND NOT EXISTS (SELECT 1 FROM "user_season_passes" t WHERE t."userId" = ${tid} AND t."seasonId" = g."seasonId")`;
      }

      // 8) Số dư — cộng số dư đọc từ dòng khách ĐÃ KHOÁ ở trên; đồng bộ zaloId/tên/SĐT nếu target
      //    còn thiếu. Nhánh gộp theo SĐT (target là user web cũ, chưa có zaloId) cần gắn ĐÚNG
      //    zaloId vừa xác thực. Ví tiền đi qua sổ cái: một dòng MERGE_OUT ở khách, một dòng
      //    MERGE_IN ở target. Ví khách lỡ âm (dữ liệu cũ) giữ nguyên ở dòng khách: chuyển khoản
      //    âm sang target có thể bị chặn "không đủ" và làm hỏng cả lần đăng nhập.
      if (g.walletBalance > 0) {
        await applyWalletDelta(tx, {
          userId: gid,
          delta: -g.walletBalance,
          type: 'MERGE_OUT',
          refType: 'USER',
          refId: tid,
          reason: 'Gộp phiên khách vào tài khoản Zalo',
        });
        await applyWalletDelta(tx, {
          userId: tid,
          delta: g.walletBalance,
          type: 'MERGE_IN',
          refType: 'USER',
          refId: gid,
          reason: 'Nhận số dư từ phiên khách',
        });
      }
      const merged = await tx.user.update({
        where: { id: tid },
        data: {
          pointsBalance: { increment: g.pointsBalance },
          // Dòng sổ lô CONVERTED đã theo pointsTransaction.updateMany ở bước 5, nên số dư lô đi cùng.
          pointsConvertedBalance: { increment: g.pointsConvertedBalance },
          // Xu đã quy sang Điểm Xanh và bị khoá ở DB (users_coins_frozen): không chuyển cột xu.
          cashbackPending: { increment: g.cashbackPending },
          ...(!target.zaloId ? { zaloId: info.zaloId } : {}),
          ...(info.name && !target.fullName ? { fullName: info.name, avatarUrl: info.avatar ?? target.avatarUrl } : {}),
          ...(targetPhone ? { phone: targetPhone } : {}),
        },
      });

      // 9) Khoá phiên khách: thu hồi refresh token còn sống, đổi zaloId để giải phóng
      //    "guest_<deviceId>" (thiết bị cần fallback khách lần sau sẽ tạo dòng MỚI) và đưa số dư
      //    về 0. zaloId mới cũng là dấu hiệu "đã gộp" cho request song song ở trên.
      await tx.refreshToken.updateMany({ where: { userId: gid, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({
        where: { id: gid },
        data: {
          zaloId: `${guest.zaloId}_merged_${Date.now()}`,
          mergedIntoId: tid,
          // Refresh token vừa xoay trước lúc gộp còn trong khoảng ân hạn: chốt mốc để refresh() không cấp lại phiên cho khách.
          sessionsRevokedAt: new Date(),
          pointsBalance: 0,
          pointsConvertedBalance: 0,
          cashbackPending: 0,
        },
      });

      // 10) Danh tính giới thiệu (UAT R6 "khách là người mời"): người khách đã mời chuyển sang target, mã của khách quy về
      //     target qua mergedIntoId (bước 9), dòng thưởng/mốc đã theo sổ ở bước 5. Liên kết làm target tự mời mình hoặc tạo
      //     vòng (khách mời X, ..., X là tổ tiên giới thiệu của target) bị cắt và thưởng đã cấp cho nó bị thu ngay: vòng
      //     người được mời ↔ người mời làm hai lần trả hàng khoá ngược chiều nhau (40P01), tự mời thì người mời tự nhận
      //     thưởng. Khách được chính target mời (target tạo khách bằng mã của mình) cũng vậy. Khách được người khác mời: giữ
      //     nguyên (G6). So theo danh tính: dòng khách đã gộp trước đó là chính tài khoản đích của nó (mergedIntoId), nên khách
      //     G mời khách B rồi B gộp vào T trước G thì B cũng là T. Đọc lại sau khi đã khoá (người được mời, người mời của G).
      const identity = (row: { id: string; mergedIntoId: string | null }) => row.mergedIntoId ?? row.id;
      //     Chuỗi tổ tiên của target đọc bằng MỘT truy vấn đệ quy (tx đang giữ khoá gộp chung, không đi từng bước một), dừng
      //     ở MERGE_ANCESTOR_CAP bước. Khách đã mang mergedIntoId = target (bước 9) nên khi khách là tổ tiên của target chuỗi
      //     quay về target: CYCLE dừng ở đó và mọi danh tính trên vòng nằm trong `ancestors` (chỉ người được mời có danh tính
      //     trên vòng bị cắt). Chạm trần mà KHÔNG gặp vòng thì chuỗi tổ tiên dài hơn 1000 người, chỉ dựng được bằng hàng loạt
      //     phiên khách giả: coi là nghi vòng và cắt mọi người khách đã mời, vì không chứng minh được ai nằm ngoài chuỗi.
      const chain = await tx.$queryRaw<{ id: string; truncated: boolean }[]>`
        WITH RECURSIVE "chain"("id", "depth") AS (
          SELECT ${tid}::text, 0
          UNION ALL
          SELECT COALESCE(p."mergedIntoId", p."id"), c."depth" + 1
            FROM "chain" c
            JOIN "users" u ON u."id" = c."id"
            JOIN "users" p ON p."id" = u."referredById"
           WHERE c."depth" < ${MERGE_ANCESTOR_CAP}::int
        ) CYCLE "id" SET "isCycle" USING "path"
        SELECT c."id", (c."depth" = ${MERGE_ANCESTOR_CAP}::int AND NOT c."isCycle" AND u."referredById" IS NOT NULL) AS "truncated"
          FROM "chain" c JOIN "users" u ON u."id" = c."id"`;
      const ancestors = new Set(chain.map((c) => c.id));
      const truncated = chain.some((c) => c.truncated);
      const referees = await tx.$queryRaw<{ id: string; mergedIntoId: string | null }[]>`
        SELECT "id", "mergedIntoId" FROM "users" WHERE "referredById" = ${gid} ORDER BY "id" FOR NO KEY UPDATE`;
      const cyclic = referees.filter((r) => truncated || ancestors.has(identity(r))).map((r) => r.id);
      await tx.user.updateMany({
        where: { referredById: gid, ...(cyclic.length > 0 ? { id: { notIn: cyclic } } : {}) },
        data: { referredById: tid },
      });
      const [guestReferrer] = await tx.$queryRaw<{ id: string; mergedIntoId: string | null }[]>`
        SELECT p."id", p."mergedIntoId" FROM "users" u JOIN "users" p ON p."id" = u."referredById" WHERE u."id" = ${gid}`;
      const selfReferred = guestReferrer !== undefined && identity(guestReferrer) === tid;
      const cut = [...cyclic, ...(selfReferred ? [gid] : [])];
      if (cut.length > 0) {
        await tx.user.updateMany({ where: { id: { in: cut } }, data: { referredById: null } });
        for (const refereeId of cut) {
          const revoked = await revokeReferralRewardForReferee(tx, refereeId, `MERGE:${gid}`);
          // Tự mời: người được mời là chính T hoặc phiên khách của T, không có "bạn" nào để nêu tên.
          if (revoked) referralNotices.push(...revoked.notices.map((n) => (refereeId === gid || refereeId === tid ? { ...n, hideFriend: true } : n)));
        }
      }

      return cut.length > 0 ? tx.user.findUniqueOrThrow({ where: { id: tid } }) : merged;
    }, MERGE_TX_OPTIONS).catch((err: unknown) => {
      if (isMergeBusy(err)) {
        this.logger.warn(`Gộp khách ${guest.id} vào ${target.id} thua tranh khoá (quá hạn chờ hoặc deadlock), client thử lại.`);
        throw new ServiceUnavailableException(MERGE_BUSY_MESSAGE);
      }
      throw err;
    });
    await sendReferralNotices({ prisma: this.prisma, notifications: this.notifications, logger: this.logger }, referralNotices);
    return result;
  }

  /**
   * Khi create() văng lỗi do đụng zaloId (2 request đăng nhập đồng thời cùng tài khoản
   * Zalo/guest mới) → lấy user vừa được request kia tạo để đăng nhập bình thường,
   * thay vì làm rớt phiên đăng nhập hợp lệ bằng 409. Nếu lỗi không phải P2002 hoặc
   * user vẫn không tồn tại (lỗi do nguyên nhân khác) → ném lại lỗi gốc.
   */
  private async recoverFromZaloIdConflict(err: unknown, zaloId: string): Promise<User> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await this.prisma.user.findUnique({ where: { zaloId } });
      if (existing) return existing;
    }
    throw err;
  }

  /** Trả phone nếu chưa bị tài khoản khác chiếm (phone là @unique) — tránh P2002. */
  private async phoneIfFree(phone: string | null, selfId?: string): Promise<string | undefined> {
    if (!phone) return undefined;
    const owner = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (owner && owner.id !== selfId) return undefined;
    return phone;
  }

  /** Luồng đăng nhập web (Zalo Web Login OAuth): đổi code → access token → upsert user → JWT. */
  async loginWithZaloOAuth(
    code: string,
    codeVerifier?: string,
    referralCode?: string,
  ): Promise<LoginResponse> {
    const accessToken = await this.zalo.exchangeOAuthCode(code, codeVerifier);
    const info = await this.zalo.getUserInfo(accessToken);

    let user = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            zaloId: info.zaloId,
            fullName: info.name,
            avatarUrl: info.avatar,
            referralCode: await this.generateReferralCode(),
            referredById: await this.resolveReferrerId(referralCode),
          },
        });
      } catch (err) {
        // 2 request OAuth login đồng thời cùng tài khoản Zalo mới → P2002 trên zaloId;
        // dùng lại user vừa được request kia tạo thay vì làm rớt phiên đăng nhập hợp lệ.
        user = await this.recoverFromZaloIdConflict(err, info.zaloId);
      }
    } else if (info.name && user.fullName !== info.name) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { fullName: info.name, avatarUrl: info.avatar ?? user.avatarUrl },
      });
    }
    return this.issueTokens(user);
  }

  /**
   * Xoay refresh token: validate hash chưa revoke/expire → cấp cặp token mới.
   *
   * Khoảng ân hạn (JWT_REFRESH_REUSE_GRACE_SECONDS): web có nhiều tab dùng chung một cookie và cùng
   * refresh lúc mở trang, Mini App gửi lại khi mất phản hồi. Token vừa XOAY trong khoảng đó được dùng lại
   * để lấy một cặp token mới, không bị coi là đánh cắp. Ngoài khoảng đó, hoặc khi toàn bộ phiên đã bị
   * thu hồi sau lần xoay, dùng lại token đã xoay vẫn thu hồi cả chuỗi như P1-2.
   */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
    }
    // isBlocked được chặn tập trung trong issueTokens() (dùng chung cho login + refresh) —
    // không check riêng ở đây để tránh 1 user bị khoá đăng nhập lại (guest/zalo-mini-app/
    // zalo-oauth) lấy token mới, né hoàn toàn chặn refresh.
    let current = stored;
    if (!stored.revokedAt) {
      // Rotation ATOMIC: chỉ thu hồi được nếu CHƯA revoke. count=0 nghĩa là request khác vừa
      // thu hồi trước — đọc lại để biết đó là lần xoay song song hay logout/khoá.
      const now = new Date();
      const revoked = await this.prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now, rotatedAt: now },
      });
      if (revoked.count === 1) return this.issueTokens(stored.user);
      const fresh = await this.prisma.refreshToken.findUnique({ where: { id: stored.id }, include: { user: true } });
      if (!fresh) throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
      current = fresh;
    }
    if (!current.rotatedAt) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
    }
    const sessionsRevokedAt = current.user.sessionsRevokedAt;
    if (sessionsRevokedAt && sessionsRevokedAt >= current.rotatedAt) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
    }
    const graceMs = this.config.get('JWT_REFRESH_REUSE_GRACE_SECONDS', { infer: true }) * 1000;
    if (Date.now() - current.rotatedAt.getTime() <= graceMs) {
      return this.issueTokens(current.user);
    }
    // Reuse phát hiện (P1-2, docs/2026-09-08-review-progress.md): nếu kẻ trộm đã rotate 1 lần TRƯỚC KHI
    // nạn nhân refresh lại, chuỗi refresh token của kẻ trộm vẫn sống nguyên tới hết JWT_REFRESH_TTL_DAYS.
    // Thu hồi TOÀN BỘ token còn active của user — buộc cả kẻ trộm lẫn nạn nhân phải đăng nhập lại.
    await this.revokeAllSessions(current.userId);
    this.logger.warn(`Phát hiện refresh token bị dùng lại (reuse) — đã thu hồi toàn bộ phiên của user ${current.userId}.`);
    throw new UnauthorizedException('Refresh token đã được sử dụng.');
  }

  /** Thu hồi mọi refresh token còn hiệu lực và chốt mốc để token đã xoay trước đó mất ân hạn. */
  private async revokeAllSessions(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: now } });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken
      .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch((err) => this.logger.warn(`Revoke refresh token thất bại khi logout: ${err}`));
  }

  private async issueTokens(user: User): Promise<LoginResponse> {
    // Chặn TẬP TRUNG ở đây (dùng chung cho login guest/zalo-mini-app/zalo-oauth VÀ refresh):
    // nếu chỉ chặn ở refresh(), user bị khoá có thể đăng nhập lại để lấy token mới, bỏ qua
    // hoàn toàn việc khoá. Access token đang có bị JwtStrategy chặn qua SessionStateService.
    if (user.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khoá.');
    }
    // Khách đã gộp không còn là danh tính: refresh token cũ của khách không được đổi ra phiên mới (phải đăng nhập lại để
    // nhận token của tài khoản đích; mergedSessionTokens cấp token cho đích, không qua dòng khách).
    if (user.mergedIntoId) {
      throw new UnauthorizedException('Phiên đã hết hiệu lực, vui lòng đăng nhập lại.');
    }
    // Áp quyền theo SĐT (allowlist) — chạy cho cả login lẫn refresh ⇒ đổi role có hiệu lực
    // ở lần refresh kế. Không có phone / không có grant → trả nguyên user.
    user = await this.rbac.applyGrants(user);

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      zaloId: user.zaloId ?? undefined,
      ...roleClaims(user.role),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTtlDays = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, user: this.toAuthUser(user) };
  }

  toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      zaloId: user.zaloId,
      phone: user.phone,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      tierId: user.tierId,
      referralCode: user.referralCode,
      pointsBalance: user.pointsBalance,
      pointsConvertedBalance: user.pointsConvertedBalance,
      walletBalance: user.walletBalance,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Map mã giới thiệu (từ deep link ?ref=) → userId người giới thiệu, khi TẠO user mới.
   * Chuẩn hoá hoa (referralCode lưu uppercase). Trả null nếu không có/không tồn tại → khách
   * vẫn đăng ký bình thường. Chỉ gọi ở nhánh create nên referrer luôn ≠ user mới.
   */
  private async resolveReferrerId(referralCode?: string): Promise<string | null> {
    if (!referralCode) return null;
    const ref = await this.prisma.user.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
      select: { id: true },
    });
    return ref ? resolveMergedUserId(this.prisma, ref.id) : null;
  }

  /** Sinh referralCode duy nhất (8 ký tự base36 không lẫn ký tự dễ nhầm). */
  private async generateReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const exists = await this.prisma.user.findUnique({ where: { referralCode: code } });
      if (!exists) return code;
    }
    return randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  }
}
