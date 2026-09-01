import { ZaloOaEventsProcessor } from './zalo-oa-events.processor';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CskhService } from '../../cskh/cskh.service';
import type { ZaloOaMessageClient } from './zalo-oa-message.client';

const EVENT = { id: 'evt1', zaloUserId: 'zalo-u1', messageText: 'Ship bao lâu?', status: 'RECEIVED' };
const TEMPLATE = { id: 'tpl1', content: 'Nội thành 1-2 ngày.' };
const GREETING = { id: 'greet1', content: 'Chào bạn, Tubu Tree đây!' };

function setup(opts: {
  event?: unknown;
  matched?: unknown;
  greeting?: unknown;
  priorCount?: number;
  sendResult?: boolean;
} = {}) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    oaInboundMessage: {
      findUnique: jest.fn().mockResolvedValue(opts.event === undefined ? EVENT : opts.event),
      update,
      count: jest.fn().mockResolvedValue(opts.priorCount ?? 0),
    },
  } as unknown as PrismaService;
  const cskh = {
    matchTemplate: jest.fn().mockResolvedValue(opts.matched ?? null),
    getGreetingTemplate: jest.fn().mockResolvedValue(opts.greeting ?? null),
  } as unknown as CskhService;
  const client = {
    sendText: jest.fn().mockResolvedValue(opts.sendResult ?? true),
  } as unknown as ZaloOaMessageClient;
  const proc = new ZaloOaEventsProcessor(prisma, cskh, client);
  return { proc, prisma, cskh, client, update };
}

describe('ZaloOaEventsProcessor.process', () => {
  it('event không tồn tại hoặc đã xử lý → bỏ qua, không update', async () => {
    const { proc, update } = setup({ event: null });
    await proc.process({ data: { eventId: 'evt1' } } as never);
    expect(update).not.toHaveBeenCalled();
  });

  it('khớp template theo từ khoá → gửi + đánh dấu REPLIED + matchedTemplateId', async () => {
    const { proc, client, update } = setup({ matched: TEMPLATE });
    await proc.process({ data: { eventId: 'evt1' } } as never);
    expect(client.sendText).toHaveBeenCalledWith('zalo-u1', TEMPLATE.content);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt1' },
      data: { status: 'REPLIED', matchedTemplateId: 'tpl1' },
    });
  });

  it('không khớp nhưng là tin ĐẦU TIÊN của user + có greeting → gửi lời chào', async () => {
    const { proc, client, update } = setup({ matched: null, greeting: GREETING, priorCount: 0 });
    await proc.process({ data: { eventId: 'evt1' } } as never);
    expect(client.sendText).toHaveBeenCalledWith('zalo-u1', GREETING.content);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt1' },
      data: { status: 'REPLIED', matchedTemplateId: 'greet1' },
    });
  });

  it('không khớp + KHÔNG phải tin đầu tiên → không gửi greeting, đánh dấu SKIPPED', async () => {
    const { proc, client, update } = setup({ matched: null, greeting: GREETING, priorCount: 2 });
    await proc.process({ data: { eventId: 'evt1' } } as never);
    expect(client.sendText).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'evt1' }, data: { status: 'SKIPPED' } });
  });

  it('không khớp gì + không có greeting nào cấu hình → SKIPPED', async () => {
    const { proc, client, update } = setup({ matched: null, greeting: null, priorCount: 0 });
    await proc.process({ data: { eventId: 'evt1' } } as never);
    expect(client.sendText).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'evt1' }, data: { status: 'SKIPPED' } });
  });

  it('gửi thất bại → đánh dấu FAILED (vẫn ghi matchedTemplateId), không throw', async () => {
    const { proc, update } = setup({ matched: TEMPLATE, sendResult: false });
    await expect(proc.process({ data: { eventId: 'evt1' } } as never)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'evt1' },
      data: { status: 'FAILED', matchedTemplateId: 'tpl1' },
    });
  });

  it('lỗi bất ngờ trong lúc xử lý → không throw ra ngoài worker (best-effort, không retry)', async () => {
    const { proc, cskh, update } = setup({});
    (cskh.matchTemplate as jest.Mock).mockRejectedValue(new Error('DB down'));
    await expect(proc.process({ data: { eventId: 'evt1' } } as never)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({ where: { id: 'evt1' }, data: { status: 'FAILED' } });
  });
});
