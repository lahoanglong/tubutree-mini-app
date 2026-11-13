import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WpImageSyncService } from './wp-image-sync.service';
import { PRODUCT_IMAGES_LIMIT } from './wp-image-sync.core';

export class ApproveWpImagesDto {
  /** Thiếu = dùng bộ ảnh mặc định của ứng viên. Có = tập con của ảnh WordPress đang trả cho sản phẩm này (service kiểm lại, DTO không tin). */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(PRODUCT_IMAGES_LIMIT) @ArrayUnique() @IsString({ each: true }) @MaxLength(1_000, { each: true }) imageUrls?: string[];
}

/** Bàn duyệt ảnh WordPress cho sản phẩm chưa có ảnh. Chỉ ADMIN; prefix riêng để không đụng route theo id của `admin/catalog-products`. */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/catalog-wp-images')
export class WpImageSyncController {
  constructor(private readonly svc: WpImageSyncService) {}

  /** `?live=1` hỏi WordPress (GET công khai, có cache 10 phút) để hiện ảnh ứng viên; không có thì chỉ đọc DB. */
  @Get()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  list(@Query('live') live?: string) {
    return this.svc.list(live === '1');
  }

  /** Mỗi lượt tải và nén tới 8 ảnh nên giới hạn tốc độ chặt hơn mức chung. */
  @Post(':productId/approve')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  approve(@CurrentUser('sub') adminId: string, @Param('productId') productId: string, @Body() dto: ApproveWpImagesDto) {
    return this.svc.approve(adminId, productId, dto.imageUrls);
  }

  @Post(':productId/skip')
  skip(@CurrentUser('sub') adminId: string, @Param('productId') productId: string) {
    return this.svc.skip(adminId, productId);
  }

  @Post(':productId/restore')
  restore(@Param('productId') productId: string) {
    return this.svc.restore(productId);
  }
}
