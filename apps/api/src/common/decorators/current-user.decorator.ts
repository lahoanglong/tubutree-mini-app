import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';

/** Lấy payload user đã xác thực từ request. VD: @CurrentUser() user: JwtPayload */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
