import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import type { JwtPayload } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto, PublicReviewsQuery } from './dto/review.dto';

class VisibilityDto {
  @IsBoolean() isVisible!: boolean;
  /** `mediaKey` của dòng admin đang xem (hiện lại đánh giá có ảnh): khách vừa đổi ảnh thì 409. API cũ không gửi thì bỏ qua. */
  @IsOptional() @IsString() @MaxLength(20_000) mediaKey?: string;
}

class ApproveDto {
  /** `mediaKey` của dòng admin đang xem: bắt buộc, để ảnh khách vừa đổi (chưa ai xem) không được duyệt lên công khai. */
  @IsString() @MaxLength(20_000) mediaKey!: string;
}

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('products/:slug/reviews')
  create(
    @CurrentUser('sub') userId: string,
    @Param('slug') slug: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(userId, slug, dto);
  }

  /** FE hỏi trước khi mở ô soạn đánh giá (cần đăng nhập — không @Public). */
  @Get('products/:slug/reviews/can-review')
  canReview(@CurrentUser('sub') userId: string, @Param('slug') slug: string) {
    return this.reviews.canReview(userId, slug);
  }

  @Public()
  @PublicCache('USER_CONTENT')
  @Get('products/:slug/reviews')
  list(@Param('slug') slug: string, @Query() filter: PublicReviewsQuery) {
    return this.reviews.listByProduct(slug, filter);
  }

  /**
   * Ảnh base64 của đánh giá (danh sách trả đường dẫn này thay vì nhúng nguyên văn). Nội dung gắn với mã băm `v` trong URL
   * nên cache vĩnh viễn được. helmet đặt Cross-Origin-Resource-Policy: same-origin mặc định; miniapp (khác origin) nạp ảnh
   * bằng thẻ img nên route này phải mở cross-origin.
   */
  @Public()
  @Get('reviews/:id/images/:index')
  async image(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { mime, data } = await this.reviews.getImage(id, index);
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data, { type: mime });
  }

  /** Đánh giá của chính mình, nguyên nội dung, để điền sẵn form sửa (cần đăng nhập — không @Public). */
  @Get('reviews/:id')
  findOwn(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.reviews.findOwn(userId, id);
  }

  @Delete('reviews/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reviews.remove(user.sub, user.role, id);
  }

  // Admin ẩn/hiện review vi phạm (§6.13).
  @Roles('ADMIN')
  @Post('reviews/:id/visibility')
  setVisibility(@Param('id') id: string, @Body() dto: VisibilityDto) {
    return this.reviews.setVisibility(id, dto.isVisible, dto.mediaKey);
  }

  /** Admin duyệt đánh giá (Góc Sống Xanh): hiện công khai, cộng Điểm Xanh nếu đủ điều kiện; trả số điểm hoặc lý do không cộng. */
  @Roles('ADMIN')
  @Post('reviews/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveDto) {
    return this.reviews.approve(id, dto.mediaKey);
  }

  /** Dải "Khách hàng sống xanh cùng TubuTree" ở Trang chủ: đánh giá ảnh đã duyệt. Cờ tắt thì `enabled: false`. */
  @Public()
  @PublicCache('USER_CONTENT')
  @Get('green-corner')
  greenCorner() {
    return this.reviews.greenCorner();
  }
}
