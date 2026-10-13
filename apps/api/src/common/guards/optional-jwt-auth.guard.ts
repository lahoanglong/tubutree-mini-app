import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Cho route @Public cần biết người xem NẾU họ đã đăng nhập (vd danh sách mua chung đánh dấu nhóm mình đã tham gia):
 * có Bearer hợp lệ thì gắn req.user, thiếu/sai/hết hạn thì cho qua như khách thay vì 401.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser>(_err: unknown, user: TUser | false): TUser {
    return (user || undefined) as TUser;
  }
}
