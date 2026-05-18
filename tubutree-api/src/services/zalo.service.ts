/**
 * Zalo Service - Giao tiếp với Zalo API
 *
 * Dùng access token từ Zalo Mini App để lấy thông tin user
 * (id, tên, ảnh đại diện)
 */
import axios from 'axios';

export const verifyZaloTokenAndGetUserInfo = async (accessToken: string) => {
  try {
    // Gọi Zalo Graph API để lấy thông tin user
    const response = await axios.get('https://graph.zalo.me/v2.0/me', {
      headers: { access_token: accessToken },
      params: { fields: 'id,name,picture' },
    });

    return response.data;
  } catch (error: any) {
    console.error('Lỗi xác thực Zalo:', error.response?.data || error.message);
    throw new Error('Access token Zalo không hợp lệ');
  }
};
