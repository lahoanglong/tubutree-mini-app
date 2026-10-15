import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateRefillLocationDto, ReorderRefillLocationsDto, UpdateRefillLocationDto } from './dto/refill-location.dto';
import { RefillLocationsService } from './refill-locations.service';

/** Quản lý điểm nhận vỏ: chỉ ADMIN (nhân viên chỉ duyệt yêu cầu ở /refill/admin, không đổi nơi nhận vỏ). Không có xoá: tắt isActive. */
@Roles('ADMIN')
@Controller('admin/refill-locations')
export class RefillLocationsAdminController {
  constructor(private readonly locations: RefillLocationsService) {}

  @Get()
  list() {
    return this.locations.listAll();
  }

  @Post()
  create(@CurrentUser('sub') adminId: string, @Body() dto: CreateRefillLocationDto) {
    return this.locations.create(adminId, dto);
  }

  // Đặt trước ':id' cho dễ đọc; khác method (PUT/PATCH) nên không đụng nhau.
  @Put('order')
  reorder(@CurrentUser('sub') adminId: string, @Body() dto: ReorderRefillLocationsDto) {
    return this.locations.reorder(adminId, dto.ids);
  }

  @Patch(':id')
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: UpdateRefillLocationDto) {
    return this.locations.update(adminId, id, dto);
  }
}
