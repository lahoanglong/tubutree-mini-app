import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { GroupBuyService } from './groupbuy.service';

class CreateGroupDto {
  @IsString() @MinLength(1) productId!: string;
}

@Controller('group-buy')
export class GroupBuyController {
  constructor(private readonly groupBuy: GroupBuyService) {}

  /** Công khai cho khách xem, nhưng nếu đã đăng nhập thì đánh dấu nhóm mình đã tham gia / tự mở. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(@CurrentUser('sub') userId?: string) {
    return this.groupBuy.listOpen(userId);
  }

  @Get(':id')
  detail(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.groupBuy.getGroup(id, userId);
  }

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateGroupDto) {
    return this.groupBuy.create(userId, dto.productId);
  }

  @Post(':id/join')
  join(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.groupBuy.join(userId, id);
  }
}
