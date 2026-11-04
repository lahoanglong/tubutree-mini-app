import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '@tubutree/shared-types';
import type { Env } from '../../../config/env.validation';
import { SessionStateService, roleClaims } from '../session-state.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly sessions: SessionStateService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  /**
   * Giá trị return gắn vào request.user. Role lấy từ DB chứ không từ token: admin vừa bị hạ quyền vẫn cầm
   * access token ghi ADMIN tới khi hết hạn và đã dùng nó để tự cấp lại quyền (ADMINOPS-1).
   */
  async validate(payload: JwtPayload & { iat?: number; iatMs?: number }): Promise<JwtPayload> {
    const state = await this.sessions.get(payload.sub);
    const expired = () => new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      code: 'SESSION_EXPIRED',
      message: 'Phiên đăng nhập không còn hợp lệ.',
    });
    if (!state) throw expired();
    if (state.mergedIntoId) throw expired();
    // Khoá trước mốc thu hồi: block() cũng ghi sessionsRevokedAt, người bị khoá phải nhận ACCOUNT_BLOCKED (có hướng dẫn liên hệ CSKH).
    if (state.isBlocked) throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá. Bạn liên hệ CSKH Tubu Tree để được hỗ trợ.' });
    if (state.sessionsRevokedAt) {
      const revokedMs = state.sessionsRevokedAt.getTime();
      if (typeof payload.iatMs === 'number') {
        // Token mới mang iatMs: so theo mili giây để đăng nhập ngay sau lần thu hồi (cùng giây) dùng được ngay.
        if (payload.iatMs <= revokedMs) throw expired();
      } else if (typeof payload.iat !== 'number' || payload.iat <= Math.floor(revokedMs / 1000)) {
        // Token cũ chỉ có iat làm tròn xuống giây: so ở mức giây và dùng <= để token cấp cùng giây với lần thu hồi vẫn bị chặn.
        throw expired();
      }
    }
    const staffPermissions = state.role === 'STAFF' ? (state.staffPermissions ?? []) : [];
    if (state.role === payload.role) return { ...payload, staffPermissions };
    return { ...payload, role: state.role, ...roleClaims(state.role), staffPermissions };
  }
}
