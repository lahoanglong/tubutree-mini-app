import { CHAT_CONFIG_DEFAULTS, type ChatConfig } from './external-chat.config';
import {
  chatCarrierOk,
  chatDueAction,
  evaluateChatClaim,
  holdUntilOf,
  creatorStaffUserId,
  isSameAsPancakeCreator,
  linkableMemberPhone,
  CHAT_SKIP_TEXT,
  verifiedMemberPhone,
  type ChatClaimFacts,
} from './external-chat.rules';
import { pancakeCreatorRefs } from './external-order.mapper';

const DAY = 864e5;
const NOW = new Date('2026-10-20T05:00:00.000Z');

const cfg = (over: Partial<ChatConfig> = {}): ChatConfig => ({
  ...CHAT_CONFIG_DEFAULTS,
  enabled: true,
  earnPct: 2,
  pendingDays: 14,
  externalSince: null,
  maxAgeDays: 60,
  ...over,
});

const facts = (over: Partial<ChatClaimFacts> = {}): ChatClaimFacts => ({
  now: NOW,
  cfg: cfg(),
  order: { status: 'OPEN', pancakeStatus: 1, hasExtendCode: true, hasTrackingCode: true, goodsValue: 500_000, insertedAt: new Date(NOW.getTime() - DAY), phone: '0912345678' },
  member: null,
  phoneIsStaff: false,
  monthPoints: 0,
  ...over,
});

describe('evaluateChatClaim: tính điểm', () => {
  it('thành viên: nhân hệ số hạng hiện tại, tính vào xét hạng không nằm ở đây nhưng userId được gắn', () => {
    const d = evaluateChatClaim(facts({ member: { id: 'u1', isStaff: false, tierMultiplier: 1.2 } }));
    expect(d).toMatchObject({ kind: 'CLAIM', state: 'PENDING', userId: 'u1', multiplier: 1.2, ratePct: 2, points: 12_000 });
  });

  it('chưa là thành viên: hệ số 1, userId null', () => {
    const d = evaluateChatClaim(facts());
    expect(d).toMatchObject({ kind: 'CLAIM', state: 'PENDING', userId: null, multiplier: 1, points: 10_000 });
  });

  it('tỉ lệ lấy từ cfg.earnPct (đã quyết chat_order_earn_pct hay loyalty.earn_pct)', () => {
    expect(evaluateChatClaim(facts({ cfg: cfg({ earnPct: 3 }) }))).toMatchObject({ points: 15_000, ratePct: 3 });
  });

  it('tiền hàng null: REVIEW, không coi là 0 điểm', () => {
    const d = evaluateChatClaim(facts({ order: { ...facts().order, goodsValue: null } }));
    expect(d).toMatchObject({ kind: 'CLAIM', state: 'REVIEW', points: 0 });
  });

  it('điểm quy ra 0: bỏ qua', () => {
    expect(evaluateChatClaim(facts({ order: { ...facts().order, goodsValue: 10 } }))).toEqual({ kind: 'SKIP', reason: 'ZERO_POINTS' });
  });
});

describe('evaluateChatClaim: điều kiện nhận', () => {
  it('cờ tắt: không tạo', () => {
    expect(evaluateChatClaim(facts({ cfg: cfg({ enabled: false }) }))).toEqual({ kind: 'SKIP', reason: 'DISABLED' });
  });
  it('không có SĐT: không tạo', () => {
    expect(evaluateChatClaim(facts({ order: { ...facts().order, phone: null } }))).toEqual({ kind: 'SKIP', reason: 'NO_PHONE' });
  });
  it.each(['RETURNED', 'CANCELLED', 'DELETED'] as const)('đơn %s: không tạo', (status) => {
    expect(evaluateChatClaim(facts({ order: { ...facts().order, status } }))).toEqual({ kind: 'SKIP', reason: 'CLOSED' });
  });
  it('yêu cầu vận đơn: thiếu extend_code và không phải status 16 thì không tạo', () => {
    const order = { ...facts().order, hasExtendCode: false, pancakeStatus: 3 };
    expect(evaluateChatClaim(facts({ order }))).toEqual({ kind: 'SKIP', reason: 'NO_CARRIER' });
  });
  it('status 16 đủ điều kiện dù không có extend_code', () => {
    const order = { ...facts().order, hasExtendCode: false, pancakeStatus: 16 };
    expect(evaluateChatClaim(facts({ order }))).toMatchObject({ kind: 'CLAIM', state: 'PENDING' });
  });
  it('tắt yêu cầu vận đơn thì không cần', () => {
    const order = { ...facts().order, hasExtendCode: false, pancakeStatus: 1 };
    expect(evaluateChatClaim(facts({ order, cfg: cfg({ requireCarrier: false }) }))).toMatchObject({ kind: 'CLAIM' });
  });
  it('trước external_since: không tạo; quá tuổi: không tạo', () => {
    const since = new Date(NOW.getTime() - DAY / 2);
    expect(evaluateChatClaim(facts({ cfg: cfg({ externalSince: since }) }))).toEqual({ kind: 'SKIP', reason: 'BEFORE_SINCE' });
    const old = { ...facts().order, insertedAt: new Date(NOW.getTime() - 61 * DAY) };
    expect(evaluateChatClaim(facts({ order: old }))).toEqual({ kind: 'SKIP', reason: 'TOO_OLD' });
  });
});

describe('evaluateChatClaim: chống nhân viên tạo đơn giả', () => {
  it('tiền hàng vượt chat_order_review_above_vnd: REVIEW', () => {
    const d = evaluateChatClaim(facts({ order: { ...facts().order, goodsValue: 5_000_001 } }));
    expect(d).toMatchObject({ state: 'REVIEW' });
    expect((d as { reviewReason: string }).reviewReason).toMatch(/ngưỡng/);
  });
  it('đúng ngưỡng 5.000.000 vẫn tự duyệt', () => {
    expect(evaluateChatClaim(facts({ order: { ...facts().order, goodsValue: 5_000_000 } }))).toMatchObject({ state: 'PENDING' });
  });
  it('thành viên là STAFF/ADMIN: REVIEW', () => {
    const d = evaluateChatClaim(facts({ member: { id: 's1', isStaff: true, tierMultiplier: 1 } }));
    expect(d).toMatchObject({ state: 'REVIEW', userId: 's1' });
    expect((d as { reviewReason: string }).reviewReason).toMatch(/nhân viên/);
  });
  it('SĐT đơn trùng SĐT của nhân viên (kể cả khi chưa là thành viên): REVIEW', () => {
    expect(evaluateChatClaim(facts({ phoneIsStaff: true }))).toMatchObject({ state: 'REVIEW', userId: null });
  });
  it('đơn hoàn một phần: REVIEW', () => {
    expect(evaluateChatClaim(facts({ order: { ...facts().order, status: 'PARTIAL_RETURN' } }))).toMatchObject({ state: 'REVIEW' });
  });
  it('vượt trần tháng theo SĐT: REVIEW', () => {
    expect(evaluateChatClaim(facts({ monthPoints: 195_000, cfg: cfg({ monthlyPointsCap: 200_000 }) }))).toMatchObject({ state: 'REVIEW' });
    expect(evaluateChatClaim(facts({ monthPoints: 190_000, cfg: cfg({ monthlyPointsCap: 200_000 }) }))).toMatchObject({ state: 'PENDING' });
  });
});

describe('chatCarrierOk', () => {
  it('extend_code hoặc status 16', () => {
    expect(chatCarrierOk({ partner: { extend_code: 'GHN123456789' } }, 1)).toBe(true);
    expect(chatCarrierOk({ partner: { extend_code: '  ' } }, 1)).toBe(false);
    expect(chatCarrierOk({}, 16)).toBe(true);
    expect(chatCarrierOk({ tracking_number: 'ABCDEFGH12' }, 3)).toBe(false);
  });
});

describe('chatDueAction và giữ điểm', () => {
  const claim = (over: Partial<{ state: 'PENDING' | 'HELD_NO_MEMBER'; userId: string | null; holdUntil: Date | null }> = {}) => ({ state: 'PENDING' as const, userId: 'u1' as string | null, holdUntil: null as Date | null, ...over });
  const delivered = (daysAgo: number) => ({ status: 'DELIVERED' as const, deliveredAt: new Date(NOW.getTime() - daysAgo * DAY) });

  it('chưa đủ 14 ngày: chờ; đủ hạn có thành viên: cộng; đủ hạn chưa có thành viên: giữ', () => {
    expect(chatDueAction(claim(), delivered(13), NOW, cfg())).toBe('WAIT');
    expect(chatDueAction(claim(), delivered(14), NOW, cfg())).toBe('CREDIT');
    expect(chatDueAction(claim({ userId: null }), delivered(14), NOW, cfg())).toBe('HOLD');
  });
  it('đơn chưa giao: chờ', () => {
    expect(chatDueAction(claim(), { status: 'OPEN', deliveredAt: null }, NOW, cfg())).toBe('WAIT');
  });
  it('HELD_NO_MEMBER: còn hạn chờ, quá holdUntil thì LAPSE', () => {
    const held = claim({ state: 'HELD_NO_MEMBER', userId: null, holdUntil: new Date(NOW.getTime() + DAY) });
    expect(chatDueAction(held, delivered(20), NOW, cfg())).toBe('WAIT');
    expect(chatDueAction({ ...held, holdUntil: new Date(NOW.getTime() - 1) }, delivered(50), NOW, cfg())).toBe('LAPSE');
  });
  it('holdUntil = mốc cộng + chat_unclaimed_hold_days, không phải lúc cron chạy', () => {
    const releaseAt = new Date('2026-10-01T00:00:00.000Z');
    expect(holdUntilOf(releaseAt, cfg())).toEqual(new Date(releaseAt.getTime() + 30 * DAY));
    expect(holdUntilOf(releaseAt, cfg({ holdDays: 7 }))).toEqual(new Date(releaseAt.getTime() + 7 * DAY));
  });
});

describe('verifiedMemberPhone: chỉ SĐT đã xác minh qua Zalo và còn hạn mới được tự liên kết', () => {
  const verify = { now: NOW, maxDays: 180 };
  const user = { phone: '0912345678', phoneVerifiedAt: new Date(NOW.getTime() - 10 * DAY) as Date | null, zaloId: 'z_real', isBlocked: false, mergedIntoId: null as string | null };
  it('tài khoản Zalo thật có SĐT hợp lệ, xác minh còn mới: trả SĐT', () => {
    expect(verifiedMemberPhone(user, verify)).toBe('0912345678');
  });
  it.each([
    ['không có SĐT', { phone: null }],
    ['khách vãng lai (zaloId guest_)', { zaloId: 'guest_abc' }],
    ['không có zaloId', { zaloId: null }],
    ['bị khoá', { isBlocked: true }],
    ['đã gộp vào tài khoản khác', { mergedIntoId: 'u2' }],
    ['SĐT sai dạng', { phone: '12345' }],
    ['SĐT có ký tự lạ', { phone: '09123456xx' }],
    ['chưa từng xác minh', { phoneVerifiedAt: null }],
    ['xác minh quá 180 ngày', { phoneVerifiedAt: new Date(NOW.getTime() - 181 * DAY) }],
  ] as const)('bỏ qua: %s', (_name, patch) => {
    expect(verifiedMemberPhone({ ...user, ...patch }, verify)).toBeNull();
  });
  it('đúng 180 ngày vẫn còn hạn; hạn đổi theo cấu hình', () => {
    const at = new Date(NOW.getTime() - 180 * DAY);
    expect(verifiedMemberPhone({ ...user, phoneVerifiedAt: at }, verify)).toBe('0912345678');
    expect(verifiedMemberPhone({ ...user, phoneVerifiedAt: at }, { now: NOW, maxDays: 30 })).toBeNull();
  });
});

describe('SĐT xác minh cũ: vẫn là người nhận nhưng chờ kiểm', () => {
  const u = { phone: '0912345678', zaloId: 'z_real', isBlocked: false, mergedIntoId: null as string | null };
  it('linkableMemberPhone không xét mốc xác minh, vẫn loại khách vãng lai, khoá, đã gộp, số sai dạng', () => {
    expect(linkableMemberPhone(u)).toBe('0912345678');
    expect(linkableMemberPhone({ ...u, zaloId: 'guest_a' })).toBeNull();
    expect(linkableMemberPhone({ ...u, isBlocked: true })).toBeNull();
    expect(linkableMemberPhone({ ...u, mergedIntoId: 'x' })).toBeNull();
    expect(linkableMemberPhone({ ...u, phone: '123' })).toBeNull();
  });
  it('phoneStale: claim gắn thành viên, REVIEW với lý do xác minh cũ', () => {
    const d = evaluateChatClaim(facts({ member: { id: 'u1', isStaff: false, tierMultiplier: 1, phoneStale: true } }));
    expect(d).toMatchObject({ kind: 'CLAIM', state: 'REVIEW', userId: 'u1' });
    expect((d as { reviewReason: string }).reviewReason).toContain('xác minh đã cũ');
  });
  it('mọi lý do SKIP đều có câu giải thích cho người kiểm', () => {
    for (const r of ['DISABLED', 'NO_PHONE', 'CLOSED', 'NO_CARRIER', 'BEFORE_SINCE', 'TOO_OLD', 'ZERO_POINTS'] as const) expect(CHAT_SKIP_TEXT[r]).toBeTruthy();
  });
});

describe('evaluateChatClaim: status 16 và người tạo đơn', () => {
  const order = (o: Partial<ChatClaimFacts['order']>) => ({ ...facts().order, ...o });
  it('status 16 không extend_code, không mã vận đơn: REVIEW; có một trong hai thì PENDING', () => {
    const base = { status: 'DELIVERED' as const, pancakeStatus: 16, hasExtendCode: false, hasTrackingCode: false };
    expect(evaluateChatClaim(facts({ order: order(base) }))).toMatchObject({ kind: 'CLAIM', state: 'REVIEW' });
    expect(evaluateChatClaim(facts({ order: order({ ...base, hasTrackingCode: true }) }))).toMatchObject({ state: 'PENDING' });
    expect(evaluateChatClaim(facts({ order: order({ ...base, hasExtendCode: true }) }))).toMatchObject({ state: 'PENDING' });
  });
  it('tắt require_carrier thì status 16 không vận đơn không bị REVIEW vì lý do này', () => {
    const o = order({ status: 'DELIVERED', pancakeStatus: 16, hasExtendCode: false, hasTrackingCode: false });
    expect(evaluateChatClaim(facts({ cfg: cfg({ requireCarrier: false }), order: o }))).toMatchObject({ state: 'PENDING' });
  });
  it('người tạo đơn là chính thành viên nhận điểm: REVIEW', () => {
    expect(evaluateChatClaim(facts({ member: { id: 'u1', isStaff: false, tierMultiplier: 1 }, creatorIsMember: true }))).toMatchObject({ state: 'REVIEW' });
  });
  it('trần điểm tự cộng theo người tạo: vượt thì REVIEW, null thì không áp trần', () => {
    const c = cfg({ creatorMonthlyPoints: 25_000 });
    expect(evaluateChatClaim(facts({ cfg: c, creatorMonthPoints: 16_000 }))).toMatchObject({ state: 'REVIEW' });
    expect(evaluateChatClaim(facts({ cfg: c, creatorMonthPoints: 15_000 }))).toMatchObject({ state: 'PENDING' });
    expect(evaluateChatClaim(facts({ cfg: c, creatorMonthPoints: null }))).toMatchObject({ state: 'PENDING' });
  });
});

describe('người tạo đơn trên Pancake không tự duyệt', () => {
  it('đọc người tạo từ payload (id và tên)', () => {
    const refs = pancakeCreatorRefs({ creator: { id: 'pc-7', name: 'Nguyễn Thị Lan' }, assigning_seller: { id: 'pc-9', name: 'Trần Văn B' } });
    expect(refs).toEqual(expect.arrayContaining([{ id: 'pc-7', name: 'nguyen thi lan' }, { id: 'pc-9', name: 'tran van b' }]));
  });
  it('payload không có người tạo: mảng rỗng', () => {
    expect(pancakeCreatorRefs({ id: 1 })).toEqual([]);
  });
  it('trùng tên (không phân biệt dấu, hoa thường) với người duyệt thì chặn', () => {
    const refs = pancakeCreatorRefs({ creator: { id: 'pc-7', name: 'Nguyễn Thị Lan' } });
    expect(isSameAsPancakeCreator({ fullName: 'nguyen thi lan' }, refs)).toBe(true);
    expect(isSameAsPancakeCreator({ fullName: 'Lê Văn C' }, refs)).toBe(false);
    expect(isSameAsPancakeCreator({ fullName: null }, refs)).toBe(false);
    expect(isSameAsPancakeCreator({ fullName: 'Lê Văn C' }, [])).toBe(false);
  });

  it('pancake.staff_map: so theo id tài khoản Pancake, kể cả khi tên khác hẳn', () => {
    const refs = pancakeCreatorRefs({ creator: { id: 'pc-7', name: 'Ten Khac' } });
    const map = new Map([['pc-7', 'staff-1']]);
    expect(isSameAsPancakeCreator({ id: 'staff-1', fullName: 'Le Van C' }, refs, map)).toBe(true);
    expect(isSameAsPancakeCreator({ id: 'staff-2', fullName: 'Le Van C' }, refs, map)).toBe(false);
    expect(creatorStaffUserId(refs, map)).toBe('staff-1');
    expect(creatorStaffUserId(refs, new Map())).toBeNull();
    expect(creatorStaffUserId([], map)).toBeNull();
  });
});
