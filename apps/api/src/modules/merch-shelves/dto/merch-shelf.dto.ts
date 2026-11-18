import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { MERCH_PIN_NOTE_MAX, MERCH_SHELF_MAX_PINS } from '../merch-shelf';

const SHELF_KEY_MAX = 140;

export class MerchShelfKeyQuery {
  @IsString() @IsNotEmpty() @MaxLength(SHELF_KEY_MAX) key!: string;
}

export class MerchSuggestQuery extends MerchShelfKeyQuery {
  /** Id món đang có trong bản nháp chưa lưu, phân cách dấu phẩy: gợi ý bỏ qua để không đề xuất lại. */
  @IsOptional() @IsString() @MaxLength(2000) @Matches(/^[A-Za-z0-9_,-]*$/) exclude?: string;
}

export class MerchProductQuery {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsOptional() @IsString() @MaxLength(SHELF_KEY_MAX) key?: string;
}

export class MerchPinDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() endsAt?: string | null;
  @IsOptional() @Trim() @IsString() @MaxLength(MERCH_PIN_NOTE_MAX) note?: string | null;
}

/** Lưu cả kệ một lần: thứ tự trong `pins` là thứ tự trên kệ. `version` lấy từ lần đọc kệ gần nhất; kệ đã bị người khác lưu thì nhận 409. */
export class SaveMerchShelfDto {
  @IsString() @IsNotEmpty() @MaxLength(SHELF_KEY_MAX) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) version!: string;
  @IsArray() @ArrayMaxSize(MERCH_SHELF_MAX_PINS) @ValidateNested({ each: true }) @Type(() => MerchPinDto) pins!: MerchPinDto[];
}
