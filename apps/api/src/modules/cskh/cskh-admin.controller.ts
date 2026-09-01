import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CskhService } from './cskh.service';
import { CreateQuickReplyDto, UpdateQuickReplyDto } from './dto/quick-reply.dto';

@Roles('ADMIN')
@Controller('admin/quick-replies')
export class CskhAdminController {
  constructor(private readonly cskh: CskhService) {}

  @Get()
  listAll() {
    return this.cskh.listAll();
  }

  @Post()
  create(@Body() dto: CreateQuickReplyDto) {
    return this.cskh.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuickReplyDto) {
    return this.cskh.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.cskh.remove(id);
  }
}
