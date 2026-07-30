import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import type { JwtPayload } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ReviewsService } from './reviews.service';
import type { CreateReviewDto } from './dto/review.dto';

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

  @Public()
  @Get('products/:slug/reviews')
  list(@Param('slug') slug: string) {
    return this.reviews.listByProduct(slug);
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
