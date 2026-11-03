import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { IsAvatarUrl } from '../../../common/uploaded-image';
import { NO_HTML } from './address.dto';

export class UpdateMeDto {
  @OptionalNotNull()
  @IsString()
  @MaxLength(120)
  @Matches(NO_HTML, { message: 'Tên không được chứa ký tự < hoặc >.' })
  fullName?: string;

  @OptionalNotNull()
  @IsEmail()
  email?: string;

  @OptionalNotNull()
  @IsAvatarUrl()
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
