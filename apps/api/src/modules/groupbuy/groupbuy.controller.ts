import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { GroupBuyService } from './groupbuy.service';

class CreateGroupDto {
  @IsString() @MinLength(1) productId!: string;
}

@Controller('group-buy')
export class GroupBuyController {
  constructor(private readonly groupBuy: GroupBuyService) {}

  @Public()
  @Get()
  list() {
    return this.groupBuy.listOpen();
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
