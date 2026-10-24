import { NOTIFY_DELAY_MS, NOTIFY_DEDUPE_MS, ReplyNotifier, SUPPORT_NOTIFY_JOB } from './reply-notifier';
import { SupportChatNotifyProcessor } from './support-chat-notify.processor';

const conv = { id: 'c1', userId: 'u1' };
const msg = { id: 'm1', body: 'Dạ đơn giao chiều nay ạ', imageUrl: null };

function notifierSetup(addImpl?: () => Promise<unknown>) {
  const queue: any = { add: jest.fn().mockImplementation(addImpl ?? (() => Promise.resolve({}))) };
  const notifications: any = { notify: jest.fn().mockResolvedValue(undefined) };
  return { notifier: new ReplyNotifier(notifications, queue), queue, notifications };
}

describe('ReplyNotifier.scheduleReplyBell', () => {
  it('đặt job trễ 20 giây, jobId notify-<messageId>, chưa báo ngay', async () => {
    const { notifier, queue, notifications } = notifierSetup();
    await notifier.scheduleReplyBell(conv, msg);
    expect(queue.add).toHaveBeenCalledWith(SUPPORT_NOTIFY_JOB, { messageId: 'm1' }, expect.objectContaining({ jobId: 'notify-m1', delay: NOTIFY_DELAY_MS }));
    expect(NOTIFY_DELAY_MS).toBe(20_000);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('đặt job lỗi (Redis sập): báo ngay cùng mẫu và khoá gộp 10 phút', async () => {
    const { notifier, notifications } = notifierSetup(() => Promise.reject(new Error('redis down')));
    await notifier.scheduleReplyBell(conv, msg);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      'SUPPORT_CHAT_REPLY',
      { preview: 'Dạ đơn giao chiều nay ạ', route: '/chat' },
      { dedupeKey: 'support-reply-c1', dedupeWithinMs: NOTIFY_DEDUPE_MS },
    );
  });

  it('đặt job treo quá hạn: báo ngay', async () => {
    jest.useFakeTimers();
    try {
      const { notifier, notifications } = notifierSetup(() => new Promise(() => undefined));
      const p = notifier.scheduleReplyBell(conv, msg);
      await jest.advanceTimersByTimeAsync(2_500);
      await p;
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SupportChatNotifyProcessor', () => {
  const T0 = new Date('2026-10-24T10:00:00Z');
  function setup(o: { message?: any; conversation?: any } = {}) {
    const message = o.message === undefined ? { id: 'm1', conversationId: 'c1', body: 'Dạ vâng', imageUrl: null, recalledAt: null, seenAt: null, createdAt: T0 } : o.message;
    const conversation = o.conversation === undefined ? { id: 'c1', userId: 'u1', customerReadAt: null } : o.conversation;
    const prisma: any = {
      supportMessage: { findUnique: jest.fn().mockResolvedValue(message) },
      supportConversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
    };
    const notifications: any = { notify: jest.fn().mockResolvedValue(undefined) };
    const notifier = new ReplyNotifier(notifications, {} as any);
    return { proc: new SupportChatNotifyProcessor(prisma, notifier), notifications };
  }
  const job: any = { data: { messageId: 'm1' } };

  it('tin chưa được khách thấy (seenAt null): báo (cùng mẫu, khoá gộp 10 phút), dù customerReadAt đã muộn hơn createdAt', async () => {
    const { proc, notifications } = setup({ conversation: { id: 'c1', userId: 'u1', customerReadAt: new Date(T0.getTime() + 60_000) } });
    await proc.process(job);
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'SUPPORT_CHAT_REPLY', { preview: 'Dạ vâng', route: '/chat' }, { dedupeKey: 'support-reply-c1', dedupeWithinMs: NOTIFY_DEDUPE_MS });
  });

  it('tin đã được khách thấy (seenAt đặt): không báo', async () => {
    const { proc, notifications } = setup({ message: { id: 'm1', conversationId: 'c1', body: 'x', imageUrl: null, recalledAt: null, seenAt: new Date(), createdAt: T0 } });
    await proc.process(job);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('tin đã bị thu hồi: không báo', async () => {
    const { proc, notifications } = setup({ message: { id: 'm1', conversationId: 'c1', body: 'x', imageUrl: null, recalledAt: new Date(), seenAt: null, createdAt: T0 } });
    await proc.process(job);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('tin hoặc hội thoại không còn: bỏ êm', async () => {
    const a = setup({ message: null });
    await a.proc.process(job);
    expect(a.notifications.notify).not.toHaveBeenCalled();
    const b = setup({ conversation: null });
    await b.proc.process(job);
    expect(b.notifications.notify).not.toHaveBeenCalled();
  });
});
