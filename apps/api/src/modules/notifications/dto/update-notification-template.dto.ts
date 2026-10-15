import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class UpdateNotificationTemplateDto {
  @OptionalNotNull()
  @IsIn(['INAPP', 'ZNS'], { message: 'Kênh chỉ nhận INAPP hoặc ZNS' })
  channel?: 'INAPP' | 'ZNS';

  /** Chuỗi rỗng hoặc null = xoá mã mẫu. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(20)
  zaloTemplateId?: string | null;

  @OptionalNotNull()
  @IsString()
  @MaxLength(1000)
  bodyTemplate?: string;
}
