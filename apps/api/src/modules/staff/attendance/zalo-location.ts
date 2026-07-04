import axios, { AxiosError } from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('ZaloLocation');

/**
 * Đổi token getLocation() (zmp-sdk) → toạ độ, qua Zalo Graph /me/info (giống resolvePhoneNumber:
 * header access_token + code(token) + secret_key). Best-effort — trả null nếu thiếu secret/lỗi.
 * LƯU Ý: cần kiểm chứng shape response với Zalo thật (latitude/longitude).
 */
export async function resolveZaloLocation(
  secret: string | undefined,
  token: string,
  accessToken: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!secret) {
    logger.warn('resolveZaloLocation: thiếu ZALO_APP_SECRET — bỏ qua.');
    return null;
  }
  try {
    const res = await axios.get('https://graph.zalo.me/v2.0/me/info', {
      headers: { access_token: accessToken, code: token, secret_key: secret },
      timeout: 8000,
    });
    const data = res.data as {
      data?: { latitude?: string | number; longitude?: string | number };
      error?: number;
      message?: string;
    };
    if (data.error && data.error !== 0) {
      logger.warn(`resolveZaloLocation Zalo error ${data.error}: ${data.message ?? ''}`);
      return null;
    }
    const lat = Number(data.data?.latitude);
    const lng = Number(data.data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (err) {
    logger.error(`resolveZaloLocation error: ${(err as AxiosError).message}`);
    return null;
  }
}
