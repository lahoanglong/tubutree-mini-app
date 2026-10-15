import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RefillService } from './refill.service';

class ReturnBottlesDto {
  @IsInt() @Min(1) @Max(100) quantity!: number;
  /** Điểm nhận khách chọn (id trong /refill/me.pickupLocations); bản app cũ không gửi. */
  @IsOptional() @IsString() @MaxLength(64) pickupLocationId?: string;
}

class ApproveReturnDto {
  /** Số vỏ nhân viên đếm được tại điểm nhận; bỏ trống = đủ số khách khai. */
  @IsOptional() @IsInt() @Min(1) @Max(100) receivedQuantity?: number;
}

class RejectReturnDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@Controller('refill')
export class RefillController {
  constructor(private readonly refill: RefillService) {}

  // Tổng quan: trần tháng còn lại, tổng vỏ đã tái chế, lịch sử gần đây.
  @Get('me')
  summary(@CurrentUser('sub') userId: string) {
    return this.refill.getSummary(userId);
  }

  // Đổi N vỏ chai rỗng → tạo đơn PENDING chờ duyệt. Idempotency-Key: bấm đúp/retry không tạo yêu cầu thứ hai.
  @Post('return')
  returnBottles(
    @CurrentUser('sub') userId: string,
    @Body() dto: ReturnBottlesDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.refill.returnBottles(userId, dto.quantity, idempotencyKey, dto.pickupLocationId);
  }

  // Admin/Staff: Lấy danh sách đổi vỏ chờ duyệt
  @Roles('STAFF', 'ADMIN')
  @Get('admin/pending')
  listPending(@Query() query: CursorPageQuery) {
    return this.refill.listPending({ cursor: query.cursor, take: query.take ? Number(query.take) : undefined });
  }

  // Admin/Staff: Duyệt đơn đổi vỏ chai
  @Roles('STAFF', 'ADMIN')
  @Post('admin/:id/approve')
  approve(@CurrentUser('sub') reviewerId: string, @Param('id') id: string, @Body() dto: ApproveReturnDto) {
    return this.refill.approveReturn(id, reviewerId, dto?.receivedQuantity);
  }

  // Admin/Staff: Từ chối đơn đổi vỏ chai
  @Roles('STAFF', 'ADMIN')
  @Post('admin/:id/reject')
  reject(@CurrentUser('sub') reviewerId: string, @Param('id') id: string, @Body() dto: RejectReturnDto) {
    return this.refill.rejectReturn(id, reviewerId, dto?.reason);
  }
}
