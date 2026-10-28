import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { requireIdempotencyKey } from '../../common/idempotency-key';
import { LoyaltyService } from './loyalty.service';
import { PosCreditDto, PosCreditListQuery, ScanMemberDto } from './dto/loyalty-staff.dto';

@Controller()
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('me/loyalty')
  overview(@CurrentUser('sub') userId: string) {
    return this.loyalty.getOverview(userId);
  }

  @Get('me/points/transactions')
  transactions(@CurrentUser('sub') userId: string) {
    return this.loyalty.getPointsTransactions(userId);
  }

  @Get('me/coupons')
  coupons(@CurrentUser('sub') userId: string) {
    return this.loyalty.getAvailableCoupons(userId);
  }

  /** Khối "Quà khách mới" ở Trang chủ: khách chưa có đơn kèm voucher chào mừng còn dùng được. */
  @Get('me/new-customer-offer')
  newCustomerOffer(@CurrentUser('sub') userId: string) {
    return this.loyalty.getNewCustomerOffer(userId);
  }

  /** Danh mục quà/voucher có thể đổi bằng Điểm Xanh. */
  @Get('me/loyalty/rewards')
  rewards(@CurrentUser('sub') userId: string) {
    return this.loyalty.getRewardCatalog(userId);
  }

  /** Xem trước kho quà và bảng hạng cho khách chưa đăng nhập: chỉ dữ liệu danh mục, không có trường riêng của khách. */
  @Public()
  @PublicCache('CATALOG')
  @Get('loyalty/preview')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  preview() {
    return this.loyalty.getPublicPreview();
  }

  /** Các lượt đổi quà của khách (mã QG- của lượt còn chờ nhận). */
  @Get('me/loyalty/rewards/mine')
  myRedemptions(@CurrentUser('sub') userId: string) {
    return this.loyalty.getMyRedemptions(userId);
  }

  /** Đổi quà trong kho quà (Idempotency-Key bắt buộc). */
  @Post('me/loyalty/rewards/:id/redeem')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  redeemReward(
    @CurrentUser('sub') userId: string,
    @Param('id') rewardId: string,
    @Headers('idempotency-key') rawKey: string | undefined,
  ) {
    return this.loyalty.redeemReward(userId, rewardId, requireIdempotencyKey(rawKey));
  }

  /** Trạng thái điểm danh 7 ngày (chỉ đọc). Điểm danh thật đi qua POST /me/daily-check-in để chuỗi chung và vé giữ lửa được cập nhật. */
  @Get('me/loyalty/check-in')
  checkInStatus(@CurrentUser('sub') userId: string) {
    return this.loyalty.getDailyCheckInStatus(userId);
  }

  /** Thông tin Thẻ thành viên số (Digital Member Card). */
  @Get('me/loyalty/member-card')
  memberCard(@CurrentUser('sub') userId: string) {
    return this.loyalty.getMemberCard(userId);
  }

  /**
   * Nhân viên/Quầy tra cứu thành viên theo mã thẻ hoặc SĐT (chỉ tra cứu, KHÔNG cộng điểm).
   * @Roles chặn theo JWT; service kiểm lại role trong DB (JWT có thể cũ sau khi bị hạ quyền).
   * Throttle để không dò quét danh sách thành viên.
   */
  @Post('loyalty/staff/scan-member')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  scanMember(@CurrentUser('sub') staffUserId: string, @Body() dto: ScanMemberDto) {
    return this.loyalty.lookupMemberByStaff(staffUserId, dto.memberCode);
  }

  /**
   * Nhân viên tích điểm cho hoá đơn tại quầy. receiptId là khoá idempotency; trần theo hoá đơn và
   * theo ngày (nhân viên / thành viên) đọc từ SystemConfig; mặc định TẮT (loyalty.pos_credit_enabled).
   */
  @Post('loyalty/staff/pos-credit')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  posCredit(@CurrentUser('sub') staffUserId: string, @Body() dto: PosCreditDto) {
    return this.loyalty.creditPosPoints(staffUserId, dto);
  }

  /** Sổ audit tích điểm tại quầy (bảng pos_point_credits) — chỉ ADMIN. */
  @Get('admin/loyalty/pos-credits')
  @Roles('ADMIN')
  posCredits(@Query() q: PosCreditListQuery) {
    return this.loyalty.listPosCredits(q);
  }
}
