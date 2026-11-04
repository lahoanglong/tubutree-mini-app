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
  async validate(payload: JwtPayload & { iat?: number }): Promise<JwtPayload> {
    const state = await this.sessions.get(payload.sub);
    const expired = () => new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      code: 'SESSION_EXPIRED',
      message: 'Phiên đăng nhập không còn hợp lệ.',
    });
    if (!state) throw expired();
    if (state.mergedIntoId) throw expired();
    // iat của JWT làm tròn xuống giây, sessionsRevokedAt có mili giây: so ở mức giây và dùng <= để token cấp
    // cùng giây với lần thu hồi vẫn bị chặn (thà bắt đăng nhập lại còn hơn để lọt token của phiên vừa bị cắt).
    if (state.sessionsRevokedAt) {
      const revokedSec = Math.floor(state.sessionsRevokedAt.getTime() / 1000);
      if (typeof payload.iat !== 'number' || payload.iat <= revokedSec) throw expired();
    }
    if (state.isBlocked) throw new UnauthorizedException({ statusCode: 401, error: 'Unauthorized', code: 'ACCOUNT_BLOCKED', message: 'Tài khoản đã bị khoá. Bạn liên hệ CSKH Tubu Tree để được hỗ trợ.' });
    const staffPermissions = state.role === 'STAFF' ? (state.staffPermissions ?? []) : [];
    if (state.role === payload.role) return { ...payload, staffPermissions };
    return { ...payload, role: state.role, ...roleClaims(state.role), staffPermissions };
  }
}
