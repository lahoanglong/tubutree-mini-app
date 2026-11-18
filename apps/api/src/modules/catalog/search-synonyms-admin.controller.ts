import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSearchSynonymDto, UpdateSearchSynonymDto } from './dto/search-synonym.dto';
import { SearchMatchService, type SearchSynonymRow } from './search-match.service';

/**
 * Thẻ "Từ khoá tìm kiếm" (web admin `/admin/tu-khoa-tim`): từ đồng nghĩa của ô tìm. Chỉ ADMIN, như thẻ cấu hình: một dòng sai đổi kết quả
 * tìm của mọi khách. Có tác dụng khi cờ `catalog.search_fuzzy_enabled` bật.
 */
@Roles('ADMIN')
@Controller('admin/search-synonyms')
export class SearchSynonymsAdminController {
  constructor(private readonly search: SearchMatchService) {}

  @Get()
  async list(): Promise<{ items: SearchSynonymRow[] }> {
    return { items: await this.search.listSynonyms() };
  }

  @Post()
  create(@Body() body: CreateSearchSynonymDto): Promise<SearchSynonymRow> {
    return this.search.createSynonym(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateSearchSynonymDto): Promise<SearchSynonymRow> {
    return this.search.updateSynonym(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ ok: true }> {
    return this.search.removeSynonym(id);
  }
}
