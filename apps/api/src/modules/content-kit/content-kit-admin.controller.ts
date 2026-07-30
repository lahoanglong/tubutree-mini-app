import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { ContentKitService } from './content-kit.service';
import type { UpsertContentKitDto } from './dto/content-kit.dto';

/** Admin: quản lý bộ nội dung bán hàng theo từng sản phẩm (bài mẫu/USP/FAQ/media). */
@Roles('ADMIN')
@Controller('admin/content-kits')
export class ContentKitAdminController {
  constructor(private readonly contentKit: ContentKitService) {}

  @Get(':productId')
  get(@Param('productId') productId: string) {
    return this.contentKit.get(productId);
  }

  @Put(':productId')
  upsert(@Param('productId') productId: string, @Body() dto: UpsertContentKitDto) {
    return this.contentKit.upsert(productId, dto);
  }
}
