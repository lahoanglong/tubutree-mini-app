import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ContentKitService } from './content-kit.service';

/** CTV: xem bộ nội dung bán hàng (bài mẫu/USP/FAQ/media) đã tự chèn tên mình + link giới thiệu. */
@Roles('AFFILIATE', 'STAFF', 'ADMIN')
@Controller('affiliate/content-kit')
export class ContentKitController {
  constructor(private readonly contentKit: ContentKitService) {}

  @Get(':slug')
  getForCtv(@CurrentUser('sub') userId: string, @Param('slug') slug: string) {
    return this.contentKit.getForCtv(userId, slug);
  }
}
