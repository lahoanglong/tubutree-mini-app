import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { FaqService } from './faq.service';
import type { CreateFaqDto, UpdateFaqDto } from './dto/faq.dto';

@Roles('ADMIN')
@Controller('admin/faqs')
export class FaqAdminController {
  constructor(private readonly faq: FaqService) {}

  @Get()
  listAll() {
    return this.faq.listAll();
  }

  @Post()
  create(@Body() dto: CreateFaqDto) {
    return this.faq.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    return this.faq.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.faq.remove(id);
  }
}
