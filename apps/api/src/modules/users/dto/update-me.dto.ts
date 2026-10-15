import { IsEmail, IsString, IsUrl, Matches, MaxLength } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class UpdateMeDto {
  @OptionalNotNull()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @OptionalNotNull()
  @IsEmail()
  email?: string;

  @OptionalNotNull()
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  avatarUrl?: string;

  /**
   * Ngày sinh — dùng cho voucher sinh nhật. Bắt buộc đúng dạng date-only "YYYY-MM-DD"
   * (không dùng @IsDateString vì nó chấp nhận cả datetime kèm offset; service ép
   * thẳng qua `new Date(dob)` nên offset lệch múi giờ có thể đổi ngày lưu xuống DB).
   */
  @OptionalNotNull()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob phải theo định dạng YYYY-MM-DD.' })
  dob?: string;
}
