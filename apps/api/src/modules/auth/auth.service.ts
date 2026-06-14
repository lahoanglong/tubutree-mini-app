import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser, JwtPayload, LoginResponse } from '@tubutree/shared-types';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { ZaloService } from './zalo.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly zalo: ZaloService,
  ) {}

  /** Luồng đăng nhập Mini App: verify token Zalo → upsert user (+ SĐT) → trả JWT. */
  async loginWithZaloMiniApp(
    code: string,
    accessToken: string,
    phoneToken?: string,
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
      return this.issueTokens(
        await this.prisma.user.create({
          data: {
            zaloId: info.zaloId,
            fullName: info.name,
            avatarUrl: info.avatar,
            phone: await this.phoneIfFree(phone),
            referralCode: await this.generateReferralCode(),
          },
        }),
      );
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

  /** Trả phone nếu chưa bị tài khoản khác chiếm (phone là @unique) — tránh P2002. */
  private async phoneIfFree(phone: string | null, selfId?: string): Promise<string | undefined> {
    if (!phone) return undefined;
    const owner = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
    if (owner && owner.id !== selfId) return undefined;
    return phone;
  }

  /** Luồng đăng nhập web (Zalo Web Login OAuth): đổi code → access token → upsert user → JWT. */
  async loginWithZaloOAuth(code: string, codeVerifier?: string): Promise<LoginResponse> {
    const accessToken = await this.zalo.exchangeOAuthCode(code, codeVerifier);
    const info = await this.zalo.getUserInfo(accessToken);

    let user = await this.prisma.user.findUnique({ where: { zaloId: info.zaloId } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          zaloId: info.zaloId,
          fullName: info.name,
          avatarUrl: info.avatar,
          referralCode: await this.generateReferralCode(),
        },
      });
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
    // Rotation ATOMIC: chỉ thu hồi được nếu CHƯA revoke. count=0 nghĩa là token đã
    // bị dùng (double-submit / reuse) → từ chối, tránh 1 token cũ sinh 2 session.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new UnauthorizedException('Refresh token đã được sử dụng.');
    }
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken
      .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  private async issueTokens(user: User): Promise<LoginResponse> {
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

  private toAuthUser(user: User): AuthUser {
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
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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
