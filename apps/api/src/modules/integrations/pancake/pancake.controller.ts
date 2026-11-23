import { Body, Controller, Get, HttpException, Param, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AllowStaff } from '../../../common/staff-permissions';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PancakeSyncService } from './pancake-sync.service';
import { PancakeOrderService } from './pancake-order.service';
import { pancakeErrorText } from './pancake-outbound';
import { BULK_RETRY_MAX } from './pancake-bulk-retry';

export class BulkPushRetryDto {
  @IsArray({ message: 'Danh sách đơn cần đẩy lại không hợp lệ.' })
  @ArrayNotEmpty({ message: 'Chọn ít nhất một đơn để đẩy lại.' })
  @ArrayMaxSize(BULK_RETRY_MAX, { message: `Mỗi lần đẩy lại tối đa ${BULK_RETRY_MAX} đơn.` })
  @IsString({ each: true, message: 'Mã đơn cần đẩy lại không hợp lệ.' })
  @MaxLength(64, { each: true, message: 'Mã đơn cần đẩy lại không hợp lệ.' })
  ids!: string[];
}

@Controller('admin/pancake')
export class PancakeController {
  constructor(
    private readonly sync: PancakeSyncService,
    private readonly orders: PancakeOrderService,
  ) {}

  /**
   * Trigger đồng bộ catalog thủ công (admin).
   *
   * `?withStock=1` để GHI ĐÈ tồn kho theo số của Pancake. Mặc định KHÔNG ghi, vì lượt quét không
   * có mốc `updatedSince` đụng toàn bộ catalog và sẽ hồi sinh hàng vừa bán hết cục bộ. Nhưng khi
   * tồn kho local đã lệch thật (sự cố webhook, sửa tay nhầm) thì đây là đường sửa DUY NHẤT trong
   * app — không có cờ này thì chỉ còn cách chạy SQL.
   */
  @Roles('ADMIN')
  @Post('sync')
  async runSync(@Query('withStock') withStock?: string) {
    const overwriteStock = withStock === '1' || withStock === 'true';
    let count: number;
    try {
      count = await this.sync.syncProducts(undefined, { forceStock: overwriteStock });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        `Không đồng bộ được danh mục Pancake (${pancakeErrorText(err)}). Thử lại sau ít phút; lỗi kéo dài thì kiểm khoá Pancake.`,
      );
    }
    // Lượt quét toàn bộ vừa chạy trên replica này: trả luôn SKU Pancake báo giá 0đ (giá Tubu đã được giữ) để người bấm biết sửa ở đâu.
    const zero = this.sync.lastZeroPrice();
    return {
      synced: count,
      stockOverwritten: overwriteStock,
      zeroPriceAnomalies: { count: zero?.count ?? 0, keptCount: zero?.keptCount ?? 0, newCount: zero?.newCount ?? 0, skus: zero?.skus ?? [] },
    };
  }

  /** Nhóm hàng Pancake + danh mục Tubu đã ánh xạ (`pancake.category_map`), để điền bản đồ ở tab Cấu hình. */
  @Roles('ADMIN')
  @Get('categories')
  async categories() {
    try {
      return await this.sync.listPancakeCategories();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(`Không đọc được nhóm hàng Pancake (${pancakeErrorText(err)}).`);
    }
  }

  /**
   * "Đẩy lại Pancake": xếp lại lệnh tạo đơn kho cho đơn chưa lên Pancake (lỗi, hết lượt, quá hạn tự đẩy). Luật an
   * toàn (không đẩy đơn đã huỷ/đã rời kho/chưa thanh toán qua cổng) nằm ở PancakeOrderService.retryPushByAdmin;
   * tạo trùng được chặn bằng tra cứu theo mã đơn trước khi tạo lại.
   */
  @Roles('ADMIN')
  @AllowStaff('KHO')
  @Post('orders/:id/push')
  retryPush(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.orders.retryPushByAdmin(adminId, id);
  }

  /**
   * "Đẩy lại đơn tạm lỗi" ở Sức khoẻ hệ thống (một đơn hoặc cả danh sách đơn kẹt đang hiện): chỉ đơn lỗi tạm (TRANSIENT/CONFIG_RECHECK),
   * chưa quá hạn tự đẩy, và qua đủ cổng đẩy như nút ở chi tiết đơn. Trả kết quả từng đơn; đơn bị từ chối không chặn đơn khác.
   */
  @Roles('ADMIN')
  @AllowStaff('KHO')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('orders/push-retry')
  retryPushMany(@CurrentUser('sub') adminId: string, @Body() body: BulkPushRetryDto) {
    return this.orders.retryManyByAdmin(adminId, body.ids);
  }
}
