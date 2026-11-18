import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

/** Thân POST /admin/search-synonyms. Độ dài kiểm lại sau khi gấp dấu (`normalizePair`). */
export class CreateSearchSynonymDto {
  @Trim() @IsString() @MinLength(2) @MaxLength(60) term!: string;
  @Trim() @IsString() @MinLength(2) @MaxLength(60) canonical!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Thân PATCH /admin/search-synonyms/:id: đổi vế thay thế hoặc bật/tắt; muốn đổi `term` thì xoá rồi thêm dòng mới. */
export class UpdateSearchSynonymDto {
  @OptionalNotNull() @Trim() @IsString() @MinLength(2) @MaxLength(60) canonical?: string;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
}
