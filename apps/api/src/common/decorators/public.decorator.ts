import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Đánh dấu route không cần JWT (login, webhook, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
