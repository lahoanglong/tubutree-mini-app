import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { aiChat } from './ai';

describe('ai — hợp đồng gọi API', () => {
  it('chat tư vấn gửi message và history', async () => {
    const { http, calls } = fakeHttp();
    await aiChat(http, 'xin chào', [{ role: 'user', content: 'a' }]);
    expect(calls).toEqual([
      { method: 'post', path: '/ai-advisor/chat', body: { message: 'xin chào', history: [{ role: 'user', content: 'a' }] } },
    ]);
  });
});
