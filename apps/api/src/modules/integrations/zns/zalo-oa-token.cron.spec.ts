import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ZaloOaTokenCron } from './zalo-oa-token.cron';
import type { ZaloOaTokenService } from './zalo-oa-token.service';

describe('ZaloOaTokenCron', () => {
  it('đọc cấu hình lỗi giữa lượt cron không ném ra ngoài và log khớp chuỗi mà màn Sức khoẻ hệ thống bảo tìm', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const tokens = { refreshIfNeeded: jest.fn().mockRejectedValue(new Error('Timed out fetching a new connection (P2024)')) };
      const cron = new ZaloOaTokenCron(tokens as unknown as ZaloOaTokenService);
      await expect(cron.refresh()).resolves.toBeUndefined();
      const lines = logError.mock.calls.map((c) => String(c[0]));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Zalo OA refresh');
      expect(lines[0]).toContain('P2024');
    } finally {
      logError.mockRestore();
    }
  });

  it('refresh thành công thì log thường, không log lỗi', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const logInfo = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      const tokens = { refreshIfNeeded: jest.fn().mockResolvedValue(true) };
      await new ZaloOaTokenCron(tokens as unknown as ZaloOaTokenService).refresh();
      expect(logError).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledTimes(1);
    } finally {
      logError.mockRestore();
      logInfo.mockRestore();
    }
  });
});
