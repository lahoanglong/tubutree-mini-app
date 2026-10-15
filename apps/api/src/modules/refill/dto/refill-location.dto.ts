import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PICKUP_LOCATION_PHONE_PATTERN } from '../../../common/phone';

export const REFILL_LOCATION_NAME_MAX = 100;
export const REFILL_LOCATION_ADDRESS_MAX = 300;
export const REFILL_LOCATION_HOURS_MAX = 120;

// Rỗng = xoá số (app ẩn nút gọi); khác rỗng phải là di động, số bàn hoặc tổng đài 1800/1900 (xem PICKUP_LOCATION_PHONE_PATTERN).
const OPTIONAL_PHONE = new RegExp(`^(${PICKUP_LOCATION_PHONE_PATTERN.source})?$`);
const PHONE_MESSAGE =
  'SĐT điểm nhận phải để trống hoặc là di động (10 số bắt đầu bằng 0 hoặc +84), số bàn (02…, 10–11 số) hoặc tổng đài 1800/1900 (viết liền, không dấu cách).';

export class CreateRefillLocationDto {
  @Trim() @IsString({ message: 'Tên điểm nhận phải là chuỗi ký tự.' }) @IsNotEmpty({ message: 'Tên điểm nhận không được để trống.' })
  @MaxLength(REFILL_LOCATION_NAME_MAX, { message: `Tên điểm nhận không được dài quá ${REFILL_LOCATION_NAME_MAX} ký tự.` })
  name!: string;

  @Trim() @IsString({ message: 'Địa chỉ điểm nhận phải là chuỗi ký tự.' }) @IsNotEmpty({ message: 'Địa chỉ điểm nhận không được để trống.' })
  @MaxLength(REFILL_LOCATION_ADDRESS_MAX, { message: `Địa chỉ điểm nhận không được dài quá ${REFILL_LOCATION_ADDRESS_MAX} ký tự.` })
  address!: string;

  @IsOptional() @Trim() @IsString({ message: 'Giờ mở cửa phải là chuỗi ký tự.' })
  @MaxLength(REFILL_LOCATION_HOURS_MAX, { message: `Giờ mở cửa không được dài quá ${REFILL_LOCATION_HOURS_MAX} ký tự.` })
  hours?: string | null;

  @IsOptional() @Trim() @IsString({ message: PHONE_MESSAGE }) @Matches(OPTIONAL_PHONE, { message: PHONE_MESSAGE })
  phone?: string | null;

  @IsOptional() @IsBoolean({ message: 'Trạng thái hoạt động chỉ nhận đúng hoặc sai.' })
  isActive?: boolean;
}

export class UpdateRefillLocationDto {
  @IsOptional() @Trim() @IsString({ message: 'Tên điểm nhận phải là chuỗi ký tự.' }) @IsNotEmpty({ message: 'Tên điểm nhận không được để trống.' })
  @MaxLength(REFILL_LOCATION_NAME_MAX, { message: `Tên điểm nhận không được dài quá ${REFILL_LOCATION_NAME_MAX} ký tự.` })
  name?: string;

  @IsOptional() @Trim() @IsString({ message: 'Địa chỉ điểm nhận phải là chuỗi ký tự.' }) @IsNotEmpty({ message: 'Địa chỉ điểm nhận không được để trống.' })
  @MaxLength(REFILL_LOCATION_ADDRESS_MAX, { message: `Địa chỉ điểm nhận không được dài quá ${REFILL_LOCATION_ADDRESS_MAX} ký tự.` })
  address?: string;

  @IsOptional() @Trim() @IsString({ message: 'Giờ mở cửa phải là chuỗi ký tự.' })
  @MaxLength(REFILL_LOCATION_HOURS_MAX, { message: `Giờ mở cửa không được dài quá ${REFILL_LOCATION_HOURS_MAX} ký tự.` })
  hours?: string | null;

  @IsOptional() @Trim() @IsString({ message: PHONE_MESSAGE }) @Matches(OPTIONAL_PHONE, { message: PHONE_MESSAGE })
  phone?: string | null;

  @IsOptional() @IsBoolean({ message: 'Trạng thái hoạt động chỉ nhận đúng hoặc sai.' })
  isActive?: boolean;
}

export class ReorderRefillLocationsDto {
  /** Toàn bộ id (cả điểm đang tắt) theo thứ tự mới; thiếu hoặc thừa id là danh sách đã cũ. */
  @IsArray({ message: 'Danh sách thứ tự phải là một mảng id.' })
  @ArrayMinSize(1, { message: 'Danh sách thứ tự không được để trống.' })
  @ArrayMaxSize(100, { message: 'Danh sách thứ tự quá dài.' })
  @ArrayUnique({ message: 'Danh sách thứ tự có id bị lặp.' })
  @IsString({ each: true, message: 'Mỗi id trong danh sách thứ tự phải là chuỗi ký tự.' })
  @MaxLength(64, { each: true, message: 'Id trong danh sách thứ tự quá dài.' })
  ids!: string[];
}
