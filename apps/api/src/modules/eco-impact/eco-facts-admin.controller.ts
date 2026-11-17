import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcoFactsAdminService, type AdminEcoFact, type EcoImportResult } from './eco-facts-admin.service';
import { EcoFactBodyDto } from './eco-facts.input';

/**
 * Thẻ "Sự thật xanh" (web admin `/admin/su-that-xanh`). Chỉ ADMIN: duyệt một dòng là đưa một tuyên bố môi trường ra cho khách, không giao cho
 * nhóm nhân viên nào. Thân đọc tay (`parseEcoFactInput`) để lỗi nói đúng trường bằng tiếng Việt.
 */
@Roles('ADMIN')
@Controller('admin/eco-facts')
export class EcoFactsAdminController {
  constructor(private readonly facts: EcoFactsAdminService) {}

  @Get()
  list(@Query('status') status?: string): Promise<{ items: AdminEcoFact[] }> {
    return this.facts.list(status);
  }

  @Post()
  create(@Body() body: EcoFactBodyDto): Promise<AdminEcoFact> {
    return this.facts.create(body);
  }

  @Post('import')
  @HttpCode(200)
  importCsv(@Body() body: unknown): Promise<EcoImportResult> {
    return this.facts.importCsv(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: EcoFactBodyDto): Promise<AdminEcoFact> {
    return this.facts.update(id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentUser('sub') adminId: string, @Body() body: unknown): Promise<AdminEcoFact> {
    return this.facts.approve(id, adminId, body);
  }

  @Post(':id/retire')
  @HttpCode(200)
  retire(@Param('id') id: string): Promise<AdminEcoFact> {
    return this.facts.retire(id);
  }
}
