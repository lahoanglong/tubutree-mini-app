import { Body, Controller, ForbiddenException, Get, Put } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
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

/** Phần nào gửi thì ghi đè phần đó; bỏ trống thì giữ nguyên. `null` không phải "bỏ trường": 400 (patch-null-contract). */
export class SaveRefillPairsDto {
  @OptionalNotNull() @IsBoolean() enabled?: boolean;

  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(REFILL_ADMIN_LIST_MAX)
  @ValidateNested({ each: true })
  @Type(() => RefillPairOverrideDto)
  overrides?: RefillPairOverrideDto[];

  /** Ghép tay một chai, gộp vào danh sách đang lưu ở máy chủ (không ghi đè cặp trang chưa thấy). */
  @OptionalNotNull() @ValidateNested() @Type(() => RefillPairOverrideDto) add?: RefillPairOverrideDto;

  /** Bỏ ghép tay một chai (slug chai) trên danh sách đang lưu. */
  @OptionalNotNull() @IsString() @IsNotEmpty() @MaxLength(SLUG_MAX) remove?: string;

  /** Duyệt các cặp đang gợi ý (tên gần giống, lệch lượng) trong một lần lưu: tất cả, hoặc không cặp nào khi bảng đã đổi (409). */
  @OptionalNotNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REFILL_ADMIN_LIST_MAX)
  @ValidateNested({ each: true })
  @Type(() => RefillPairOverrideDto)
  confirm?: RefillPairOverrideDto[];

  @OptionalNotNull() @IsArray() @ArrayMaxSize(REFILL_ADMIN_LIST_MAX) @IsString({ each: true }) @MaxLength(SLUG_MAX, { each: true }) block?: string[];
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
