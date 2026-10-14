import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { IsBoolean } from 'class-validator';
import type { JwtPayload } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/review.dto';

class VisibilityDto {
  @IsBoolean() isVisible!: boolean;
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
  @Get('products/:slug/reviews')
  list(@Param('slug') slug: string) {
    return this.reviews.listByProduct(slug);
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

  @Delete('reviews/:id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reviews.remove(user.sub, user.role, id);
  }

  // Admin ẩn/hiện review vi phạm (§6.13).
  @Roles('ADMIN')
  @Post('reviews/:id/visibility')
  setVisibility(@Param('id') id: string, @Body() dto: VisibilityDto) {
    return this.reviews.setVisibility(id, dto.isVisible);
  }
}
