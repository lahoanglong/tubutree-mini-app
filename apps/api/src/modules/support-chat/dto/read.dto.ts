import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReadDto {
  /** Id các tin STAFF/SYSTEM màn khách thực sự đã hiển thị. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) ids?: string[];
  /** Bản cũ của Mini App chưa gửi ids: tin mới nhất đã hiển thị. */
  @IsOptional() @IsString() @MaxLength(64) upToId?: string;
}
