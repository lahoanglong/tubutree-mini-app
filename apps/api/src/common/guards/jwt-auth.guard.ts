import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** Guard JWT mặc định toàn app; bỏ qua route gắn @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // Passport mặc định ném UnauthorizedException() trần ("Unauthorized"); client hiện nguyên message của lỗi 4xx cho khách.
  // Lỗi do chiến lược ném (ví dụ tài khoản bị khoá) đã có chữ Việt riêng nên giữ nguyên.
  override handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (err) throw err;
    if (!user) throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'SESSION_EXPIRED',
        message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
      });
    return user;
  }
}
