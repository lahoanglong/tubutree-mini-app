import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DealerService } from './dealer.service';
import { ApplyDealerDto, DealerOrderDto } from './dto/dealer.dto';

class CreditPaymentDto {
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsString() note?: string;
}

export class ClaimRewardDto {
  /** Kỳ muốn nhận thưởng: 'Q3/2026' (thưởng quý) | '2026' (thưởng năm). Bỏ trống = kỳ hiện tại. */
  @IsOptional() @IsString() @Matches(/^(Q[1-4]\/\d{4}|\d{4})$/, { message: 'Kỳ thưởng không hợp lệ.' })
  periodKey?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class TemplateItemDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) quantity!: number;
}
class SaveTemplateDto {
  @IsString() name!: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => TemplateItemDto)
  items!: TemplateItemDto[];
}

@Controller('dealer')
export class DealerController {
  constructor(private readonly dealer: DealerService) {}

  @Post('apply')
  apply(@CurrentUser('sub') userId: string, @Body() dto: ApplyDealerDto) {
    return this.dealer.apply(userId, dto);
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.dealer.getMe(userId);
  }

  @Get('pricelist')
  pricelist(@CurrentUser('sub') userId: string) {
    return this.dealer.pricelist(userId);
  }

  @Post('orders')
  placeOrder(
    @CurrentUser('sub') userId: string,
    @Body() dto: DealerOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.dealer.placeOrder(userId, dto, idempotencyKey);
  }

  @Get('orders')
  orders(@CurrentUser('sub') userId: string) {
    return this.dealer.listOrders(userId);
  }

  @Get('credit-ledger')
  ledger(@CurrentUser('sub') userId: string) {
    return this.dealer.creditLedger(userId);
  }

  // A5-09: đại lý tự bấm "Báo đã CK" KHÔNG còn tự trừ nợ (xem DealerService.reportCreditPayment) —
  // chỉ tạo thông báo cho admin; sổ công nợ chỉ giảm qua admin xác nhận (DealerService.
  // adminRecordCreditPayment, DealerCreditAdminController).
  @Post('credit-payment')
  payment(@CurrentUser('sub') userId: string, @Body() dto: CreditPaymentDto) {
    return this.dealer.reportCreditPayment(userId, dto.amount, dto.note);
  }

  @Get('quarterly-report')
  quarterlyReport(@CurrentUser('sub') userId: string) {
    return this.dealer.quarterlyReport(userId);
  }

  // Tiến trình đạt mốc phần thưởng đại lý (tour/quà — hiển thị điều kiện + tiến trình).
  @Get('rewards')
  rewards(@CurrentUser('sub') userId: string) {
    return this.dealer.rewardsProgress(userId);
  }

  // Gửi yêu cầu nhận thưởng mốc (lưu DealerRewardClaim, idempotent theo đại lý + kỳ + phần thưởng).
  @Post('rewards/:id/claim')
  claimReward(
    @CurrentUser('sub') userId: string,
    @Param('id') rewardId: string,
    @Body() dto: ClaimRewardDto,
  ) {
    return this.dealer.claimReward(userId, rewardId, { periodKey: dto.periodKey, note: dto.note });
  }

  @Get('templates')
  templates(@CurrentUser('sub') userId: string) {
    return this.dealer.listTemplates(userId);
  }

  @Post('templates')
  saveTemplate(@CurrentUser('sub') userId: string, @Body() dto: SaveTemplateDto) {
    return this.dealer.saveTemplate(userId, dto.name, dto.items);
  }

  @Delete('templates/:id')
  deleteTemplate(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.dealer.deleteTemplate(userId, id);
  }
}
