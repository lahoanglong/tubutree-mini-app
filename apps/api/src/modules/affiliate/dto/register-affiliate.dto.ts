import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body đăng ký CTV. `termsVersion` là phiên bản điều khoản hoa hồng/thuế mà người dùng vừa tick
 * đồng ý trên app. Để optional vì bản miniapp cũ chưa gửi trường này (backend deploy trước).
 */
export class RegisterAffiliateDto {
  @IsOptional() @IsString() @MaxLength(32) termsVersion?: string;
}
