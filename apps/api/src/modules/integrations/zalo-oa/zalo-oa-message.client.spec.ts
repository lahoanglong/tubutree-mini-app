jest.mock('axios');
import axios from 'axios';
import { Logger } from '@nestjs/common';
import { ZaloOaMessageClient } from './zalo-oa-message.client';
import type { ZaloOaTokenService } from '../zns/zalo-oa-token.service';

const post = axios.post as jest.Mock;

function makeClient(token = 'acc') {
  const tokens = { getAccessToken: jest.fn().mockResolvedValue(token) } as unknown as ZaloOaTokenService;
  return new ZaloOaMessageClient(tokens);
}

describe('ZaloOaMessageClient.sendText', () => {
  let logError: jest.SpyInstance;
  beforeEach(() => {
    post.mockReset();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('body { error: 0 } → true', async () => {
    post.mockResolvedValue({ data: { error: 0, message: 'Success' } });
    expect(await makeClient().sendText('u1', 'Chào bạn')).toBe(true);
    expect(post.mock.calls[0][1]).toEqual({ recipient: { user_id: 'u1' }, message: { text: 'Chào bạn' } });
  });

  it('HTTP 200 nhưng body { error: -230 } → false và log mã lẫn lời của Zalo', async () => {
    post.mockResolvedValue({ data: { error: -230, message: 'User has not interacted in 48h' } });
    expect(await makeClient().sendText('u1', 'Chào bạn')).toBe(false);
    const line = String(logError.mock.calls[0]?.[0]);
    expect(line).toContain('-230');
    expect(line).toContain('User has not interacted in 48h');
  });

  it('mã lỗi dạng chuỗi cũng được đọc', async () => {
    post.mockResolvedValue({ data: { error: '-216', message: 'token hết hạn' } });
    expect(await makeClient().sendText('u1', 'x')).toBe(false);
  });

  it('body không có mã error → không coi là đã gửi', async () => {
    post.mockResolvedValue({ data: {} });
    expect(await makeClient().sendText('u1', 'x')).toBe(false);
    post.mockResolvedValue({});
    expect(await makeClient().sendText('u1', 'x')).toBe(false);
  });

  it('lỗi mạng/HTTP → false', async () => {
    post.mockRejectedValue(new Error('timeout'));
    expect(await makeClient().sendText('u1', 'x')).toBe(false);
  });

  it('chưa có access token → false, không gọi Zalo', async () => {
    expect(await makeClient('').sendText('u1', 'x')).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
