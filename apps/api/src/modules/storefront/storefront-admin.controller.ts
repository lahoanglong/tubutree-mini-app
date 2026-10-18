import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim } from '../../common/decorators/trim.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { StorefrontAdminService } from './storefront-admin.service';

export class StorefrontAdminListQueryDto extends PaginationQuery {
  @IsOptional() @IsIn(['PUBLISHED', 'DRAFT', 'TAKEN_DOWN', 'PENDING_APPROVAL']) status?: 'PUBLISHED' | 'DRAFT' | 'TAKEN_DOWN' | 'PENDING_APPROVAL';
  @IsOptional() @IsIn(['CTV', 'BRAND', 'MERCHANT']) type?: 'CTV' | 'BRAND' | 'MERCHANT';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class TakeDownStorefrontDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Cần nhập lý do gỡ đăng để báo chủ gian hàng.' })
  @MaxLength(300)
  reason!: string;
}

export class ApproveStorefrontDto {
  @IsBoolean() approved!: boolean;
}

/** Admin: kiểm duyệt gian hàng (D3-02). Chỉ ADMIN: gỡ đăng và duyệt là quyết định về nội dung công khai, không thuộc nhóm việc STAFF nào. */
@Roles('ADMIN')
@Controller('admin/storefronts')
export class StorefrontAdminController {
  constructor(private readonly admin: StorefrontAdminService) {}

  @Get()
  list(@Query() q: StorefrontAdminListQueryDto) {
    return this.admin.list(q);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.detail(id);
  }

  @Post(':id/take-down')
  @HttpCode(HttpStatus.OK)
  takeDown(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: TakeDownStorefrontDto) {
    return this.admin.takeDown(adminId, id, dto.reason);
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.admin.reinstate(adminId, id);
  }

  @Post(':id/approval')
  @HttpCode(HttpStatus.OK)
  approval(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ApproveStorefrontDto) {
    return this.admin.setApproved(adminId, id, dto.approved);
  }
}
