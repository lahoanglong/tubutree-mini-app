import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser, JwtPayload, LoginResponse } from '@tubutree/shared-types';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { ZaloService } from './zalo.service';
import { RbacService } from '../staff/rbac/rbac.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly zalo: ZaloService,
    private readonly rbac: RbacService,
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
   *    trước → gộp dữ liệu giá trị/rủi ro cao nhất của khách (giỏ, sổ địa chỉ, số dư điểm/ví/
   *    xu/cashback + sổ giao dịch, lịch sử đơn) vào user đó rồi trả token của user đó.
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

    const isGuest = currentUser.zaloId?.startsWith('guest_') ?? false;
    if (!isGuest) {
      this.logger.warn(
        `ensurePhone: user ${currentUser.id} (đã là Zalo thật, zaloId=${currentUser.zaloId}) ` +
          `đổi sang zaloId khác (${info.zaloId}) trên máy — từ chối gộp, giữ nguyên phiên hiện tại.`,
      );
      throw new ConflictException(
        'Tài khoản Zalo trên máy hiện khác với phiên đang đăng nhập. Vui lòng đăng xuất rồi đăng nhập lại để tiếp tục.',
      );
    }

    const existingByZalo = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });
    if (existingByZalo) {
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
    const upgraded = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: {
        zaloId: info.zaloId,
        fullName: info.name,
        avatarUrl: info.avatar ?? currentUser.avatarUrl,
        ...(checkedPhone ? { phone: checkedPhone } : {}),
      },
    });
    return this.issueTokens(upgraded);
  }

  /** Gắn SĐT nếu user chưa có và SĐT còn trống — dùng cho nhánh "đúng danh tính đang có". */
  private async attachPhoneIfMissing(user: User, phone: string | null): Promise<User> {
    if (!phone || user.phone) return user;
    const free = await this.phoneIfFree(phone, user.id);
    if (!free) return user;
    return this.prisma.user.update({ where: { id: user.id }, data: { phone: free } });
  }

  /**
   * Gộp guest → target (target đã tồn tại từ trước, khác dòng với guest). CHỈ gộp các bảng có
   * giá trị/rủi ro cao nhất nếu bỏ sót: giỏ hàng, sổ địa chỉ, số dư điểm/ví/xu/cashback (+ sổ
   * giao dịch, cố gắng theo kiểu best-effort), lịch sử đơn. CHƯA gộp trong bản vá khẩn cấp này:
   * gameProfile/loyaltyCheckIns/staffProfile/communityProfile/subscriptions/affiliate/dealer/
   * reviews/feed/... — phần lớn là quan hệ 1-1 (2 bên cùng có 1 dòng) cần một quyết định nghiệp
   * vụ về "chọn bên nào thắng" mà bản vá khẩn cấp không tự ý quyết; dòng khách VẪN CÒN NGUYÊN
   * trong DB (không xoá, chỉ đổi zaloId để giải phóng khoá `guest_<deviceId>`) nên không mất dữ
   * liệu — chỉ tạm thời không truy cập được qua phiên đã hợp nhất. Xem openIssues trong báo cáo
   * bàn giao P0 để biết danh sách đầy đủ + đề xuất theo dõi.
   */
  private async mergeGuestInto(
    guest: User,
    target: User,
    info: { zaloId: string; name?: string; avatar?: string },
    phone: string | null,
  ): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      // 1) Giỏ hàng — gộp theo variationId (cộng dồn số lượng dòng trùng thay vì đè), không
      //    làm mất dòng nào của cả 2 bên. QUAN TRỌNG: dòng KHÔNG trùng biến thể được REPARENT
      //    (update cartId, GIỮ NGUYÊN id) thay vì xoá-tạo-lại — màn thanh toán có thể đã chọn
      //    sẵn một tập con `itemIds` (mua 1 phần giỏ) TRƯỚC khi ensurePhone() chạy; nếu đổi id
      //    thì lựa chọn đó không còn khớp dòng nào sau khi phiên đổi sang target. Chỉ dòng THẬT
      //    SỰ trùng biến thể với target (hiếm) mới mất id gốc (không thể giữ cả 2 id cho cùng 1
      //    biến thể — ràng buộc unique [cartId, variationId]).
      const guestCart = await tx.cart.findUnique({ where: { userId: guest.id }, include: { items: true } });
      if (guestCart) {
        const targetCart = await tx.cart.upsert({
          where: { userId: target.id },
          create: { userId: target.id },
          update: {},
        });
        for (const item of guestCart.items) {
          const existing = await tx.cartItem.findUnique({
            where: { cartId_variationId: { cartId: targetCart.id, variationId: item.variationId } },
          });
          if (existing) {
            // Trùng biến thể: cộng dồn vào dòng của target (giữ id của target), xoá dòng
            // trùng của khách — không thể giữ cả 2 do ràng buộc unique.
            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity: existing.quantity + item.quantity },
            });
            await tx.cartItem.delete({ where: { id: item.id } });
          } else {
            // Không trùng: chuyển THẲNG dòng của khách sang giỏ target, GIỮ NGUYÊN id.
            await tx.cartItem.update({ where: { id: item.id }, data: { cartId: targetCart.id } });
          }
        }
        await tx.cart.delete({ where: { id: guestCart.id } }); // giờ đã rỗng (mọi dòng đã reparent/xoá ở trên)
      }

      // 2) Sổ địa chỉ — chuyển hết; nếu target đã có địa chỉ mặc định thì bỏ cờ mặc định của
      //    các địa chỉ chuyển sang (tránh 2 địa chỉ mặc định cùng lúc).
      const targetHasDefault = (await tx.address.count({ where: { userId: target.id, isDefault: true } })) > 0;
      await tx.address.updateMany({
        where: { userId: guest.id },
        data: targetHasDefault ? { userId: target.id, isDefault: false } : { userId: target.id },
      });

      // 3) Lịch sử đơn — chuyển hết (Order.userId là cột thường, không có ràng buộc unique).
      await tx.order.updateMany({ where: { userId: guest.id }, data: { userId: target.id } });

      // 4) Sổ giao dịch điểm/xu/cashback — cố migrate NGUYÊN BẢNG theo userId; nếu đụng ràng
      //    buộc unique RIÊNG của bảng đó (vd 2 dòng điểm danh CHECKIN cùng ngày ở cả guest lẫn
      //    target) thì bỏ qua CẢ BẢNG đó, giữ nguyên các dòng ở guest — KHÔNG chặn phần còn lại
      //    của merge. Số dư tổng (bước 5) vẫn đúng vì được cộng trực tiếp trên User, độc lập với
      //    việc sổ chi tiết lịch sử có chuyển được hết hay không.
      try {
        await tx.pointsTransaction.updateMany({ where: { userId: guest.id }, data: { userId: target.id } });
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
      try {
        await tx.coinTransaction.updateMany({ where: { userId: guest.id }, data: { userId: target.id } });
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
      try {
        await tx.cashbackClick.updateMany({ where: { userId: guest.id }, data: { userId: target.id } });
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }
      try {
        await tx.cashbackTransaction.updateMany({ where: { userId: guest.id }, data: { userId: target.id } });
      } catch (err) {
        if (!this.isUniqueViolation(err)) throw err;
      }

      // 5) Số dư — cộng dồn vào target; đồng bộ zaloId/tên/SĐT nếu target còn thiếu. Nhánh gộp
      //    theo SĐT (target là user web cũ, chưa có zaloId) cần gắn ĐÚNG zaloId vừa xác thực —
      //    nhánh gộp theo zaloId trùng thì target.zaloId đã sẵn bằng info.zaloId (no-op an toàn).
      const targetPhone = phone && !target.phone ? await this.phoneIfFree(phone, target.id) : undefined;
      const merged = await tx.user.update({
        where: { id: target.id },
        data: {
          pointsBalance: { increment: guest.pointsBalance },
          walletBalance: { increment: guest.walletBalance },
          coinsBalance: { increment: guest.coinsBalance },
          cashbackPending: { increment: guest.cashbackPending },
          ...(!target.zaloId ? { zaloId: info.zaloId } : {}),
          ...(info.name && !target.fullName ? { fullName: info.name, avatarUrl: info.avatar ?? target.avatarUrl } : {}),
          ...(targetPhone ? { phone: targetPhone } : {}),
        },
      });

      // 6) Khoá phiên khách: thu hồi mọi refresh token còn sống + đổi zaloId để giải phóng
      //    "guest_<deviceId>" (nếu thiết bị cần fallback khách lần sau, sẽ tạo dòng MỚI —
      //    không bao giờ tái sử dụng dòng đã gộp). Số dư ở guest xoá về 0 (đã chuyển hết ở
      //    bước 5, tránh cộng trùng nếu lỡ có đường nào đó còn đọc lại dòng này).
      await tx.refreshToken.updateMany({ where: { userId: guest.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({
        where: { id: guest.id },
        data: {
          zaloId: `${guest.zaloId}_merged_${Date.now()}`,
          pointsBalance: 0,
          walletBalance: 0,
          coinsBalance: 0,
          cashbackPending: 0,
        },
      });

      return merged;
    });
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

  /** Lỗi vi phạm ràng buộc unique của Prisma (P2002) — dùng ở mergeGuestInto() để bỏ qua từng
   *  bảng đụng ràng buộc riêng thay vì làm hỏng cả giao dịch gộp. */
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
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

  /** Xoay refresh token: validate hash chưa revoke/expire → cấp cặp token mới. */
  async refresh(refreshToken: string): Promise<LoginResponse> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token không hợp lệ hoặc đã hết hạn.');
    }
    // isBlocked được chặn tập trung trong issueTokens() (dùng chung cho login + refresh) —
    // không check riêng ở đây để tránh 1 user bị khoá đăng nhập lại (guest/zalo-mini-app/
    // zalo-oauth) lấy token mới, né hoàn toàn chặn refresh.
    // Rotation ATOMIC: chỉ thu hồi được nếu CHƯA revoke. count=0 nghĩa là token đã
    // bị dùng (double-submit / reuse) → từ chối, tránh 1 token cũ sinh 2 session.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      // Reuse phát hiện (P1-2, docs/2026-09-08-review-progress.md): trước đây chỉ chặn ĐÚNG
      // token bị replay lần này — nếu kẻ trộm đã rotate 1 lần TRƯỚC KHI nạn nhân refresh lại,
      // chuỗi refresh token của kẻ trộm (đã cấp mới, chưa revoke) vẫn sống nguyên tới hết
      // JWT_REFRESH_TTL_DAYS. Thu hồi TOÀN BỘ token còn active của user — buộc cả kẻ trộm lẫn
      // nạn nhân phải đăng nhập lại, thay vì chỉ chặn 1 token rồi coi như xong.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Phát hiện refresh token bị dùng lại (reuse) — đã thu hồi toàn bộ phiên của user ${stored.userId}.`);
      throw new UnauthorizedException('Refresh token đã được sử dụng.');
    }
    return this.issueTokens(stored.user);
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
    // hoàn toàn việc khoá. Access token đang có (TTL ngắn) vẫn còn hiệu lực tới khi hết hạn —
    // đây là giới hạn chấp nhận được của JWT stateless, không phải bug.
    if (user.isBlocked) {
      throw new UnauthorizedException('Tài khoản đã bị khoá.');
    }
    // Áp quyền theo SĐT (allowlist) — chạy cho cả login lẫn refresh ⇒ đổi role có hiệu lực
    // ở lần refresh kế. Không có phone / không có grant → trả nguyên user.
    user = await this.rbac.applyGrants(user);

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      zaloId: user.zaloId ?? undefined,
      affiliateEnabled: user.role === 'AFFILIATE' || user.role === 'ADMIN',
      dealerEnabled: user.role === 'DEALER',
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
      walletBalance: user.walletBalance,
      coinsBalance: user.coinsBalance,
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
    return ref?.id ?? null;
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
