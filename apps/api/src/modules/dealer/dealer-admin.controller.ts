import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { DealerService } from './dealer.service';

const CLAIM_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;

/** Query danh sách yêu cầu nhận thưởng — khai báo `status` trong DTO (ValidationPipe forbidNonWhitelisted). */
export class ListRewardClaimsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: (typeof CLAIM_STATUSES)[number];
}

export class ReviewRewardClaimDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectRewardClaimDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

/**
 * Admin xử lý yêu cầu nhận thưởng mốc đại lý (tour/quà): PENDING → APPROVED | REJECTED;
 * APPROVED → PAID (đã trao thưởng offline). Mọi chuyển trạng thái đều atomic trong DealerService.
 */
@Roles('ADMIN')
@Controller('admin/dealer-reward-claims')
export class DealerAdminController {
  constructor(private readonly dealer: DealerService) {}

  @Get()
  list(@Query() q: ListRewardClaimsQuery) {
    return this.dealer.listRewardClaims(q.status, q.page, q.limit);
  }

  @Post(':id/approve')
  approve(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewRewardClaimDto) {
    return this.dealer.approveRewardClaim(adminId, id, dto.note);
  }

  @Post(':id/reject')
  reject(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: RejectRewardClaimDto) {
    return this.dealer.rejectRewardClaim(adminId, id, dto.reason);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewRewardClaimDto) {
    return this.dealer.markRewardClaimPaid(adminId, id, dto.note);
  }
}
