import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';
import { COPY_DRAFT_MAX_BATCH, type CopyApproveItem } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Trim, TrimEach } from '../../common/decorators/trim.decorator';
import { COPY_INGREDIENTS_MAX } from '../ai-advisor/copy-draft';
import { OCR_IMAGE_MAX_BYTES } from '../ai-advisor/ingredient-ocr';
import { CatalogAuditService } from './catalog-audit.service';
import { CopyApproveService } from './copy-approve.service';
import { CopyDraftService } from './copy-draft.service';
import { IngredientEnrichService } from './ingredient-enrich.service';

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

// Ảnh nhãn tối đa OCR_IMAGE_MAX_BYTES, sang base64 thành ceil(n/3)*4 ký tự, cộng tiền tố data URL (dài nhất: "data:image/jpeg;base64,"). Trần thân 10 MB của /api/admin đủ chứa.
export const INGREDIENT_IMAGE_DTO_MAX = Math.ceil(OCR_IMAGE_MAX_BYTES / 3) * 4 + 64;

export class ExtractIngredientsDto {
  // Dạng và dung lượng thật do checkOcrImage kiểm trong service (kèm chữ ký tệp); ở đây chỉ chặn chuỗi rỗng và vượt trần thô.
  @IsString() @IsNotEmpty() @MaxLength(INGREDIENT_IMAGE_DTO_MAX) image!: string;
}

// Trần ở DTO rộng hơn trần nội dung (8 tên, 80 ký tự): vượt trần nội dung thì service trả 400 kèm lý do cụ thể.
export class SaveIngredientsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(COPY_INGREDIENTS_MAX + 12) @TrimEach() @IsString({ each: true }) @MaxLength(200, { each: true }) ingredients!: string[];
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
    private readonly ingredients: IngredientEnrichService,
  ) {}

  @Get('audit')
  getAudit() {
    return this.audit.audit();
  }

  @Get('pancake-zero-price')
  getPancakeZeroPrice() {
    return this.audit.pancakeZeroPrice();
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

  /** AI đọc mục Thành phần trên ảnh bao bì ra bản nháp. Không ghi DB; mỗi lượt gọi AI trả phí nên giới hạn tốc độ riêng. */
  @Post(':id/extract-ingredients')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  extractIngredients(@Param('id') id: string, @Body() dto: ExtractIngredientsDto) {
    return this.ingredients.extract(id, dto.image);
  }

  /** Lưu thành phần admin đã xem (nhập tay hoặc từ bản nháp AI): chỉ nối tên mới, giữ nguyên dòng đã có. */
  @Post(':id/ingredients')
  saveIngredients(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: SaveIngredientsDto) {
    return this.ingredients.save(adminId, id, dto.ingredients);
  }
}
