import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { MerchProductQuery, MerchShelfKeyQuery, MerchSuggestQuery, SaveMerchShelfDto } from './dto/merch-shelf.dto';
import { MerchShelvesService } from './merch-shelves.service';

@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/merch-shelves')
export class MerchShelvesController {
  constructor(private readonly shelves: MerchShelvesService) {}

  @Get()
  overview() {
    return this.shelves.overview();
  }

  @Get('shelf')
  get(@Query() q: MerchShelfKeyQuery) {
    return this.shelves.getShelf(q.key);
  }

  @Put('shelf')
  save(@CurrentUser() user: JwtPayload, @Body() dto: SaveMerchShelfDto) {
    return this.shelves.save(dto, user.sub);
  }

  @Get('suggest')
  suggest(@Query() q: MerchSuggestQuery) {
    const exclude = (q.exclude ?? '').split(',').filter(Boolean).slice(0, 50);
    return this.shelves.suggest(q.key, exclude);
  }

  @Get('product')
  product(@Query() q: MerchProductQuery) {
    return this.shelves.product(q.productId, q.key);
  }

  @Get('empty-entrances')
  emptyEntrances() {
    return this.shelves.emptyEntrances();
  }
}
