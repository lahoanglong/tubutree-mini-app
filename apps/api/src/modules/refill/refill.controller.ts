import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RefillService } from './refill.service';

class ReturnBottlesDto {
  @IsInt() @Min(1) @Max(100) quantity!: number;
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

  // Đổi N vỏ chai rỗng → tạo đơn PENDING chờ duyệt.
  @Post('return')
  returnBottles(@CurrentUser('sub') userId: string, @Body() dto: ReturnBottlesDto) {
    return this.refill.returnBottles(userId, dto.quantity);
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
