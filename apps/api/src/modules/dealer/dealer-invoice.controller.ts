import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvoiceRequestDto } from '../checkout/dto/checkout.dto';
import { DealerInvoiceRequestDto } from './dto/dealer.dto';
import { DealerInvoiceService } from './dealer-invoice.service';

/** Hoá đơn VAT của đại lý (`/dai-ly`): thông tin xuất hoá đơn lưu sẵn và gửi yêu cầu cho nhiều đơn một lần. */
@Controller('dealer')
export class DealerInvoiceController {
  constructor(private readonly invoices: DealerInvoiceService) {}

  @Get('invoice-profile')
  profile(@CurrentUser('sub') userId: string) {
    return this.invoices.profile(userId);
  }

  @Put('invoice-profile')
  saveProfile(@CurrentUser('sub') userId: string, @Body() dto: InvoiceRequestDto) {
    return this.invoices.saveProfile(userId, dto);
  }

  @Post('orders/invoice-request')
  request(@CurrentUser('sub') userId: string, @Body() dto: DealerInvoiceRequestDto) {
    return this.invoices.requestInvoices(userId, dto);
  }
}
