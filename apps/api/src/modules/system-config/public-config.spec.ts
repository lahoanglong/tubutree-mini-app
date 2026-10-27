import { buildPublicConfig } from './public-config';
import { DEFAULT_CHAT_HOURS } from '../support-chat/support-chat.config';

const build = (stored: Record<string, unknown>) =>
  buildPublicConfig({ get: jest.fn(async (key: string, fallback?: unknown) => (key in stored ? stored[key] : fallback)) } as never);

describe('buildPublicConfig — chat', () => {
  it('mặc định: tắt, giờ mặc định', async () => {
    const cfg = await build({});
    expect(cfg.chat).toEqual({ enabled: false, hours: DEFAULT_CHAT_HOURS });
  });

  it('chỉ boolean true thật mới bật', async () => {
    expect((await build({ 'chat.enabled': true })).chat.enabled).toBe(true);
    expect((await build({ 'chat.enabled': 'true' })).chat.enabled).toBe(false);
    expect((await build({ 'chat.enabled': 1 })).chat.enabled).toBe(false);
  });

  it('giờ hợp lệ được giữ, giờ hỏng rơi về mặc định', async () => {
    expect((await build({ 'chat.hours': { start: '09:00', end: '18:30' } })).chat.hours).toEqual({ start: '09:00', end: '18:30' });
    expect((await build({ 'chat.hours': { start: '25:00', end: '18:30' } })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
    expect((await build({ 'chat.hours': 'sáng' })).chat.hours).toEqual(DEFAULT_CHAT_HOURS);
  });

  it('giờ hợp lệ có khoá thừa thì chỉ trả start và end', async () => {
    const cfg = await build({ 'chat.hours': { start: '09:00', end: '18:00', note: 'internal' } });
    expect(cfg.chat.hours).toEqual({ start: '09:00', end: '18:00' });
  });

  it('không lộ mã nhóm Zalo và lời nhắn ngoài giờ', async () => {
    const cfg = await build({ 'chat.enabled': true, 'chat.zalo_group_id': 'g1', 'chat.off_hours_text': 'x' });
    expect(Object.keys(cfg.chat).sort()).toEqual(['enabled', 'hours']);
    expect(Object.keys(cfg.chat.hours).sort()).toEqual(['end', 'start']);
  });
});

describe('buildPublicConfig — đơn vị vận hành', () => {
  it('mặc định: mọi trường null', async () => {
    expect((await build({})).company).toEqual({ legalName: null, taxCode: null, address: null, bctNoticeUrl: null });
  });

  it('trả tên, MST, địa chỉ đã cắt khoảng trắng; trường rỗng hoặc sai kiểu là null', async () => {
    const cfg = await build({ 'company.legal_name': ' Công ty A ', 'company.tax_code': '0312345678', 'company.address': '   ', 'company.bct_notice_url': 5 });
    expect(cfg.company).toEqual({ legalName: 'Công ty A', taxCode: '0312345678', address: null, bctNoticeUrl: null });
  });

  it('link Bộ Công Thương chỉ nhận https (không đưa javascript: hoặc http cho khách)', async () => {
    expect((await build({ 'company.bct_notice_url': 'https://online.gov.vn/x' })).company.bctNoticeUrl).toBe('https://online.gov.vn/x');
    expect((await build({ 'company.bct_notice_url': 'javascript:alert(1)' })).company.bctNoticeUrl).toBeNull();
    expect((await build({ 'company.bct_notice_url': 'http://online.gov.vn/x' })).company.bctNoticeUrl).toBeNull();
  });
});

describe('buildPublicConfig — hệ số hạng', () => {
  const cfg = { get: jest.fn(async (_k: string, fallback?: unknown) => fallback) } as never;
  const rows = [
    { id: 't1', name: 'Mầm Xanh', pointMultiplier: '1.00' },
    { id: 't2', name: 'Lộc Biếc', pointMultiplier: { toString: () => '1.20' } },
    { id: 'bad', name: 'Hỏng', pointMultiplier: 'abc' },
    { id: 'zero', name: 'Không', pointMultiplier: 0 },
  ];

  it('trả hệ số và tên theo id hạng, bỏ hệ số hỏng', async () => {
    const r = await buildPublicConfig(cfg, async () => rows);
    expect(r.loyalty.tierMultipliers).toEqual({ t1: 1, t2: 1.2 });
    expect(r.loyalty.tierNames).toEqual({ t1: 'Mầm Xanh', t2: 'Lộc Biếc' });
  });

  it('không có bộ đọc hoặc đọc lỗi thì bảng rỗng, phần còn lại của config vẫn trả', async () => {
    expect((await buildPublicConfig(cfg)).loyalty.tierMultipliers).toEqual({});
    const r = await buildPublicConfig(cfg, async () => { throw new Error('db'); });
    expect(r.loyalty.tierMultipliers).toEqual({});
    expect(r.loyalty.earnPct).toBeGreaterThan(0);
  });
});
