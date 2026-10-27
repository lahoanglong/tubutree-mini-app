import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsUploadedImage } from '../../../common/uploaded-image';
import { CANCEL_REASON_CODES, type CancelReasonCode } from '../cancel-reasons';
import { RETURN_REASON_CODES, type ReturnReasonCode } from '../return-reasons';

/** Trường nơi nhận tiền hoàn dùng chung cho huỷ đơn, trả hàng và chọn nơi nhận khoản tiền về muộn (D2). */
export class RefundDestinationDto {
  @IsOptional() @IsIn(['WALLET', 'BANK']) refundMethod?: 'WALLET' | 'BANK';
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

/** Body tuỳ chọn của POST /orders/:code/cancel — app bản cũ gửi rỗng (hoàn về Ví như trước). */
export class CancelOrderDto extends RefundDestinationDto {
  @IsOptional() @IsIn(CANCEL_REASON_CODES) cancelReasonCode?: CancelReasonCode;
  @IsOptional() @IsString() @MaxLength(200) cancelReasonText?: string;
}

export class ChooseRefundDestinationDto {
  @IsIn(['WALLET', 'BANK']) refundMethod!: 'WALLET' | 'BANK';
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

export class ReturnLineDto {
  @IsString() @MaxLength(64) orderItemId!: string;
  @IsInt() @Min(1) @Max(9999) quantity!: number;
}

/** Body của POST /orders/:code/return-estimate: dòng + số lượng định trả và lý do (quyết định có hoàn phí ship). */
export class ReturnEstimateDto {
  @IsOptional() @IsIn(RETURN_REASON_CODES) reasonCode?: ReturnReasonCode;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items!: ReturnLineDto[];
}

export class ReturnRequestDto extends RefundDestinationDto {
  /** Lý do chọn sẵn; null = app bản cũ (chỉ có ô mô tả). */
  @IsOptional() @IsIn(RETURN_REASON_CODES) reasonCode?: ReturnReasonCode;
  /** Mô tả thêm. Bắt buộc ≥ 5 ký tự khi không chọn lý do sẵn hoặc chọn "Lý do khác" (kiểm ở service). */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  // C-050: ảnh minh chứng hiện ở admin web — chặn javascript:/data:text/html/host lạ ngay khi lưu.
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUploadedImage({}, { each: true }) images?: string[];
  /** Dòng và số lượng trả (D3). Không gửi = trả mọi phần còn lại của đơn (app bản cũ). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items?: ReturnLineDto[];
}

export class ReviewReturnDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Lỗi do shop → hoàn cả phí ship. Không gửi = theo lý do khách chọn. */
  @IsOptional() @IsBoolean() shopFault?: boolean;
  /** Số tiền admin đã thấy ở bước xác nhận; lệch số tính lại (yêu cầu khác vừa duyệt) thì từ chối để xem lại. */
  @IsOptional() @IsInt() @Min(0) expectedRefund?: number;
}

export class ReturnPreviewQuery {
  @IsOptional() @IsIn(['true', 'false']) shopFault?: 'true' | 'false';
}

export class MarkReceivedDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) note?: string;
}
