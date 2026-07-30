import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WishlistService } from './wishlist.service';

class AddWishlistDto {
  @IsString() productId!: string;
}

@Controller('me/wishlist')
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.wishlist.list(userId);
  }

  @Get('ids')
  ids(@CurrentUser('sub') userId: string) {
    return this.wishlist.ids(userId);
  }

  @Post()
  add(@CurrentUser('sub') userId: string, @Body() dto: AddWishlistDto) {
    return this.wishlist.add(userId, dto.productId);
  }

  @Delete(':productId')
  remove(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.wishlist.remove(userId, productId);
  }
}
