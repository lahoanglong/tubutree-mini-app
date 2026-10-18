import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MyExternalClaimsResponse, SubmitExternalClaimResponse } from '@tubutree/shared-types';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { PaginationQuery } from '../../common/pagination';
import { ExternalClaimService } from './external-claim.service';

export class SubmitExternalClaimDto {
  /** Giới hạn dài để chặn chuỗi rác trước khi chuẩn hoá; mã hợp lệ sau chuẩn hoá chỉ 8 đến 30 ký tự. */
  @Trim() @IsString() @MinLength(1) @MaxLength(100) code!: string;
}

/** Khách tự nhập hoặc quét mã vận đơn của đơn mua trên sàn để tích Điểm Xanh. Cờ `loyalty.marketplace_claim_enabled` tắt thì 404. */
@Controller('me/external-points')
export class ExternalClaimsController {
  constructor(private readonly claims: ExternalClaimService) {}

  @Post('claims')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  submit(@CurrentUser('sub') userId: string, @Body() dto: SubmitExternalClaimDto): Promise<SubmitExternalClaimResponse> {
    return this.claims.submit(userId, dto.code);
  }

  @Get('claims')
  list(@CurrentUser('sub') userId: string, @Query() q: PaginationQuery): Promise<MyExternalClaimsResponse> {
    return this.claims.listMine(userId, q.page, q.limit);
  }
}
