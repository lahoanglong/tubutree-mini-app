import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import type { FaqService } from './faq.service';

/** Công khai: danh sách FAQ đang bật (dùng cho miniapp hiển thị + tham chiếu chung). */
@Controller('faqs')
export class FaqController {
  constructor(private readonly faq: FaqService) {}

  @Public()
  @Get()
  list() {
    return this.faq.listActive();
  }
}
