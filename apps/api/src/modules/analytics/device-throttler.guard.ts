import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Throttle /events theo X-Device-Id thay vì IP — Wi-Fi cửa hàng/CGNAT dùng chung IP (A7-02) không
 *  được lấy hết hạn mức của nhau ở endpoint này. */
@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: { headers: Record<string, unknown>; user?: { sub?: string }; ip?: string }): Promise<string> {
    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId === 'string' && deviceId.length > 0) return deviceId;
    return req.user?.sub ?? req.ip ?? 'unknown';
  }
}
