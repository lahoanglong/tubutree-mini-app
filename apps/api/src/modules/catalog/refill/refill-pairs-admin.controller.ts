import { Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { RefillPairsService } from './refill-pairs.service';

/** Trần số cặp ghép tay và số slug chặn một lần lưu: danh mục cả trăm món, vài chục cặp là nhiều. */
export const REFILL_ADMIN_LIST_MAX = 300;
const SLUG_MAX = 200;

export class RefillPairOverrideDto {
  @IsString() @IsNotEmpty() @MaxLength(SLUG_MAX) bottleSlug!: string;
  @IsString() @IsNotEmpty() @MaxLength(SLUG_MAX) refillSlug!: string;
}

/** Phần nào gửi thì ghi đè phần đó; bỏ trống thì giữ nguyên. */
export class SaveRefillPairsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REFILL_ADMIN_LIST_MAX)
  @ValidateNested({ each: true })
  @Type(() => RefillPairOverrideDto)
  overrides?: RefillPairOverrideDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(REFILL_ADMIN_LIST_MAX) @IsString({ each: true }) @MaxLength(SLUG_MAX, { each: true }) block?: string[];
}

/**
 * Thẻ admin "Cặp Refill" (web `/admin`, nhóm Danh mục & kệ): xem chai nào đang được mời đổi sang gói Refill nào, bật/tắt từng cặp, ghép tay
 * chai ↔ gói Refill. Cùng quyền với thẻ Xếp kệ (ADMIN, nhân viên MARKETING); bật/tắt cả tính năng (`catalog.refill_first_enabled`) chỉ ADMIN,
 * như mọi cờ ở thẻ Bật/tắt tính năng.
 */
@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/refill-pairs')
export class RefillPairsAdminController {
  constructor(private readonly refill: RefillPairsService) {}

  @Get()
  overview() {
    return this.refill.adminOverview();
  }

  @Put()
  save(@CurrentUser() user: JwtPayload, @Body() dto: SaveRefillPairsDto) {
    if (dto.enabled !== undefined && user.role !== 'ADMIN') throw new ForbiddenException('Chỉ quản trị viên bật hay tắt gợi ý gói Refill.');
    return this.refill.adminSave(dto, user.sub);
  }
}
