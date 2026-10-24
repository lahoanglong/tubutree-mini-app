import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import { getSupportChatPage, markSupportChatRead, sendSupportChat, supportChatQueryOptions, supportChatSummaryQueryOptions } from './support-chat-api';

describe('support-chat-api (Mini App)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('luồng đọc dùng đúng khoá và đường dẫn của app-core', async () => {
    mocks.get.mockResolvedValue({ unreadCount: 2 });
    expect(supportChatQueryOptions().queryKey).toEqual(['support-chat']);
    expect(supportChatSummaryQueryOptions().queryKey).toEqual(['support-chat-summary']);
    await supportChatSummaryQueryOptions().queryFn();
    expect(mocks.get).toHaveBeenCalledWith('/me/support-chat/summary');
    await getSupportChatPage({ after: 'm1' });
    expect(mocks.get).toHaveBeenCalledWith('/me/support-chat/messages', { query: { after: 'm1' } });
  });

  it('gửi và đánh dấu đã đọc qua POST', async () => {
    mocks.post.mockResolvedValue({});
    await sendSupportChat({ clientMsgId: 'c1', body: 'xin chào' });
    expect(mocks.post).toHaveBeenCalledWith('/me/support-chat/messages', { clientMsgId: 'c1', body: 'xin chào' });
    await markSupportChatRead(['m1']);
    expect(mocks.post).toHaveBeenCalledWith('/me/support-chat/read', { ids: ['m1'] });
  });
});
