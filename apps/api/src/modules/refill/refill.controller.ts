import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RefillService } from './refill.service';

class ReturnBottlesDto {
  @IsInt() @Min(1) @Max(100) quantity!: number;
}

@Controller('refill')
export class RefillController {
  constructor(private readonly refill: RefillService) {}

  // Tổng quan: trần tháng còn lại, tổng vỏ đã tái chế, lịch sử gần đây.
  @Get('me')
  summary(@CurrentUser('sub') userId: string) {
    return this.refill.getSummary(userId);
  }

  // Đổi N vỏ chai rỗng → thưởng 💧.
  @Post('return')
  returnBottles(@CurrentUser('sub') userId: string, @Body() dto: ReturnBottlesDto) {
    return this.refill.returnBottles(userId, dto.quantity);
  }
}
