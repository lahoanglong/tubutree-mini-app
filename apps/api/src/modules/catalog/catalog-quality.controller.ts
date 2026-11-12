import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { COPY_DRAFT_MAX_BATCH, type CopyApproveItem } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim, TrimEach } from '../../common/decorators/trim.decorator';
import { COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { CatalogAuditService } from './catalog-audit.service';
import { CopyApproveService } from './copy-approve.service';
import { CopyDraftService } from './copy-draft.service';

export class CopyDraftsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(COPY_DRAFT_MAX_BATCH) @ArrayUnique() @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) ids!: string[];
}

// Trần ở DTO rộng hơn trần nội dung (140/800/8/80): vượt trần nội dung chỉ từ chối riêng mục đó kèm lý do, không làm 400 cả lô.
export class CopyApproveItemDto implements CopyApproveItem {
  @IsString() @IsNotEmpty() @MaxLength(64) id!: string;
  @Trim() @IsString() @MaxLength(400) shortDesc!: string;
  @Trim() @IsString() @MaxLength(6000) description!: string;
  @IsArray() @ArrayMaxSize(COPY_INGREDIENTS_MAX + 12) @TrimEach() @IsString({ each: true }) @MaxLength(200, { each: true }) ingredients!: string[];
}

export class CopyApproveDto {
  // Phần tử không phải đối tượng (`null`, số, chuỗi) phải bị 400 ở `IsObject`; `i?.id` để `ArrayUnique` không ném TypeError (500) khi chạy trước đó trên `null`.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(COPY_DRAFT_MAX_BATCH) @IsObject({ each: true }) @ArrayUnique((i: CopyApproveItemDto | null) => i?.id) @ValidateNested({ each: true }) @Type(() => CopyApproveItemDto) items!: CopyApproveItemDto[];
}

/**
 * Bàn làm việc chất lượng catalog (admin): xem sản phẩm thiếu mô tả/thành phần, nhờ AI soạn bản nháp, rồi duyệt ghi vào DB.
 * Prefix riêng `admin/catalog-quality`, không nằm dưới `admin/catalog-products/:id` để không đụng route theo id.
 */
@ApiTags('admin-catalog')
@Roles('ADMIN')
@Controller('admin/catalog-quality')
export class CatalogQualityController {
  constructor(
    private readonly audit: CatalogAuditService,
    private readonly drafts: CopyDraftService,
    private readonly approval: CopyApproveService,
  ) {}

  @Get('audit')
  getAudit() {
    return this.audit.audit();
  }

  /** Không ghi DB. Mỗi lượt có thể gọi AI trả phí nên giới hạn tốc độ riêng, chặt hơn mức chung. */
  @Post('copy-drafts')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  copyDrafts(@Body() dto: CopyDraftsDto) {
    return this.drafts.generate(dto.ids);
  }

  @Post('copy-approve')
  copyApprove(@CurrentUser('sub') adminId: string, @Body() dto: CopyApproveDto) {
    return this.approval.approve(adminId, dto.items);
  }
}
