import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
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
  placeOrder(@CurrentUser('sub') userId: string, @Body() dto: DealerOrderDto) {
    return this.dealer.placeOrder(userId, dto);
  }

  @Get('orders')
  orders(@CurrentUser('sub') userId: string) {
    return this.dealer.listOrders(userId);
  }

  @Get('credit-ledger')
  ledger(@CurrentUser('sub') userId: string) {
    return this.dealer.creditLedger(userId);
  }

  @Post('credit-payment')
  payment(@CurrentUser('sub') userId: string, @Body() dto: CreditPaymentDto) {
    return this.dealer.creditPayment(userId, dto.amount, dto.note);
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
