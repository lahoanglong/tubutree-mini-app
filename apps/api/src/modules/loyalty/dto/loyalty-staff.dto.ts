import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Nhân viên tra cứu thành viên tại quầy. Chỉ TRA CỨU — cộng điểm đi route riêng (PosCreditDto)
 * để lỗi gõ/quét nhầm mã khi tra cứu không bao giờ kéo theo cộng điểm.
 *
 * memberCode: mã trên thẻ thành viên số ("TUBU" + mã giới thiệu) hoặc SĐT đầy đủ. Khớp CHÍNH
 * XÁC ở service (LoyaltyService.resolveMember) — bản WIP dùng `endsWith` nên chuỗi rỗng/"TUBU"
 * khớp mọi user và điểm POS rơi vào khách bất kỳ.
 */
export class ScanMemberDto {
  @IsString()
  @MinLength(6)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9+\-. ]+$/, { message: 'Mã thành viên chỉ gồm chữ, số (hoặc SĐT).' })
  memberCode!: string;
}

/** Trần cứng chống tràn Int4 của points_transactions.delta; trần nghiệp vụ nằm ở SystemConfig. */
export const POS_ORDER_TOTAL_HARD_MAX = 1_000_000_000;

export class PosCreditDto extends ScanMemberDto {
  /** Tổng tiền hoá đơn tại quầy (VND). Trần nghiệp vụ: loyalty.pos_max_order_total. */
  @IsInt()
  @Min(1000)
  @Max(POS_ORDER_TOTAL_HARD_MAX)
  orderTotal!: number;

  /**
   * Mã hoá đơn POS — đồng thời là KHOÁ IDEMPOTENCY: 1 hoá đơn chỉ được tích điểm 1 lần trên toàn
   * hệ thống (unique pos_point_credits.receiptId). Gửi lại cùng mã → trả kết quả lần trước.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._\-/#]+$/, { message: 'Mã hoá đơn chỉ gồm chữ, số và . _ - / #' })
  receiptId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Admin soát sổ tích điểm tại quầy (GET admin/loyalty/pos-credits). */
export class PosCreditListQuery {
  /** Ngày theo giờ VN 'YYYY-MM-DD' (khớp pos_point_credits.dayKey). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day phải có dạng YYYY-MM-DD' })
  day?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  staffUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  memberId?: string;
}
