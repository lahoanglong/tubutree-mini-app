import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import { getSupportChat, getSupportChatPage, getSupportChatSummary, markSupportChatRead, sendSupportChat } from './support-chat';
import { supportChatQuery, supportChatSummaryQuery } from '../queries/support-chat';

describe('support-chat — hợp đồng gọi API', () => {
  it('đọc hội thoại, phân trang, gửi, đánh dấu đã đọc, đọc số chưa đọc', async () => {
    const { http, calls } = fakeHttp();
    await getSupportChat(http);
    await getSupportChatPage(http, { after: 'm1' });
    await getSupportChatPage(http, { before: 'm0' });
    await sendSupportChat(http, { clientMsgId: 'c1', body: 'Chào' });
    await markSupportChatRead(http);
    await getSupportChatSummary(http);
    expect(calls).toEqual([
      { method: 'get', path: '/me/support-chat' },
      { method: 'get', path: '/me/support-chat/messages', opts: { query: { after: 'm1' } } },
      { method: 'get', path: '/me/support-chat/messages', opts: { query: { before: 'm0' } } },
      { method: 'post', path: '/me/support-chat/messages', body: { clientMsgId: 'c1', body: 'Chào' } },
      { method: 'post', path: '/me/support-chat/read' },
      { method: 'get', path: '/me/support-chat/summary' },
    ]);
  });

  it('query: khoá và đường dẫn', async () => {
    const { http, calls } = fakeHttp();
    const a = supportChatQuery(http);
    const b = supportChatSummaryQuery(http);
    expect(a.queryKey).toEqual(['support-chat']);
    expect(b.queryKey).toEqual(['support-chat-summary']);
    await a.queryFn();
    await b.queryFn();
    expect(calls.map((c) => c.path)).toEqual(['/me/support-chat', '/me/support-chat/summary']);
  });
});
