import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CashbackService } from './cashback.service';

class ReviewCashbackDto {
  @IsIn(['CONFIRMED', 'REJECTED']) status!: 'CONFIRMED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Đường quản trị cho hoàn tiền sàn ngoài.
 *
 * Trước đây KHÔNG có endpoint admin nào cho cashback: trạng thái chỉ đổi được qua postback của
 * provider, mà cron reconcile lại tự tắt khi chưa có API key. Một postback rớt mạng là giao
 * dịch nằm PENDING vĩnh viễn — khách thấy "Chờ duyệt" vô thời hạn, không có form khiếu nại, và
 * không ai trong tổ chức có cách xử lý ngoài việc chạy SQL trực tiếp.
 */
@Roles('ADMIN')
@Controller('admin')
export class CashbackAdminController {
  constructor(private readonly cashback: CashbackService) {}

  @Get('cashback/transactions')
  list(@Query('status') status?: string, @Query('take') take?: string) {
    return this.cashback.adminListTransactions(status, take ? Number(take) : undefined);
  }

  @Post('cashback/transactions/:id/review')
  review(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: ReviewCashbackDto,
  ) {
    return this.cashback.adminReview(adminId, id, dto.status, dto.note);
  }
}
