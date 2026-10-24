import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class AdminReplyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(1000) body!: string;
}

export class AdminSettingsDto {
  /** ValidateIf thay IsOptional: bỏ qua khi vắng mặt nhưng null vẫn bị chặn (patch-null-contract). */
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() enabled?: boolean;
  /** Rỗng = bỏ chọn nhóm. */
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(64) @Matches(/^\S*$/, { message: 'groupId không được chứa khoảng trắng' }) groupId?: string;
}

export class AdminListQuery {
  @IsOptional() @IsString() @MaxLength(64) @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) q?: string;
  @IsOptional() @IsIn(['unforwarded']) filter?: 'unforwarded';
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
}
