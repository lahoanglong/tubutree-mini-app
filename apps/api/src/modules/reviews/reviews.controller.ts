import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/review.dto';

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
}
