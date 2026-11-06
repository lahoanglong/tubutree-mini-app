import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { IsAvatarUrl } from '../../../common/uploaded-image';
import { Trim } from '../../../common/decorators/trim.decorator';

export class UpdateMeDto {
  @OptionalNotNull()
  @IsString()
  // Rỗng sau khi cắt (chỉ khoảng trắng, ký tự vô hình) là xoá tên: chặn bằng lỗi rõ thay vì lưu tên rỗng. Không gửi fullName vẫn giữ tên cũ.
  @IsNotEmpty()
  @MaxLength(120)
  // `<` `>` kiểm ở UsersService.updateMe, chỉ khi tên thực sự đổi: tên Zalo được ghi đè mỗi lần đăng nhập mà không qua DTO
  // và client luôn gửi lại fullName, nên chặn ở đây sẽ khoá khách có tên như "Hoa <3" khỏi sửa hồ sơ.
  @Trim()
  fullName?: string;

  @OptionalNotNull()
  @IsEmail()
  @Trim()
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
