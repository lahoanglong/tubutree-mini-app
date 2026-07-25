import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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

  // Đổi N vỏ chai rỗng → tạo đơn PENDING chờ duyệt.
  @Post('return')
  returnBottles(@CurrentUser('sub') userId: string, @Body() dto: ReturnBottlesDto) {
    return this.refill.returnBottles(userId, dto.quantity);
  }

  // Admin/Staff: Lấy danh sách đổi vỏ chờ duyệt
  @Get('admin/pending')
  listPending() {
    return this.refill.listPending();
  }

  // Admin/Staff: Duyệt đơn đổi vỏ chai
  @Post('admin/:id/approve')
  approve(@Param('id') id: string) {
    return this.refill.approveReturn(id);
  }

  // Admin/Staff: Từ chối đơn đổi vỏ chai
  @Post('admin/:id/reject')
  reject(@Param('id') id: string) {
    return this.refill.rejectReturn(id);
  }
}
