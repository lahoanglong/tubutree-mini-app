import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { FIELD_LABELS, FIELD_LABELS_BY_DTO } from './validation-pipe';

/**
 * Lỗi 400 hiện nguyên văn message[0] cho khách/admin: trường không có nhãn sẽ hiện «Trường «companyName»».
 * Spec duyệt metadata class-validator của mọi DTO trong src và đòi mỗi tên trường có nhãn tiếng Việt, hoặc nằm
 * trong danh sách miễn bên dưới (kèm lý do).
 */
const SRC = join(__dirname, '..');

/** Trường người dùng không gõ chữ vào: lý do nằm ở chuỗi đầu của từng nhóm. */
const exempt = (reason: string, names: string[]): Record<string, string> => Object.fromEntries(names.map((n) => [n, reason]));
const FLAG_REASON = 'cờ đúng/sai do công tắc hoặc hộp chọn gửi lên; lỗi chỉ có thể là sai kiểu, không do người dùng gõ';
const EXEMPT: Record<string, string> = {
  ...exempt(FLAG_REASON, ['acceptWalletForfeit', 'active', 'allowDuplicate', 'approve', 'approved', 'blocked', 'changedAfterApproval', 'confirmDirectProducts', 'confirmTakeover', 'confirmedNoWaybill', 'consent', 'debtOnly', 'disabled', 'enabled', 'giftHandoverEnabled', 'guests', 'hasVideo', 'hazardous', 'inStock', 'isActive', 'isDefault', 'isEmergency', 'isFeatured', 'isGreeting', 'isHidden', 'isPartner', 'isPinned', 'isPublished', 'isVerified', 'isVisible', 'listed', 'missing', 'missingImage', 'newCustomerOnly', 'notifyGarden', 'notifyPromo', 'onSale', 'overdue', 'packagingConsent', 'paused', 'perkPending', 'phoneMatchConfirmed', 'pinned', 'postagePaidConsent', 'quotedZeroTotal', 'shipLocked', 'takeOver', 'tubuFulfils', 'uncategorized']),
  ...exempt("khoá kỹ thuật: id, danh sách id, token, mã tham chiếu hệ thống do ứng dụng điền, không có ô nhập", ['accessToken', 'addressId', 'anchorProductId', 'anonymousId', 'beforeId', 'brandId', 'card', 'categoryId', 'categoryIds', 'clientMsgId', 'codeVerifier', 'collectionId', 'deviceId', 'eventId', 'expectedTakeoverProductId', 'groupId', 'id', 'ids', 'itemId', 'itemIds', 'key', 'link', 'locationToken', 'memberId', 'merchantId', 'notificationId', 'orderId', 'orderItemId', 'orderedIds', 'ownerUserId', 'pancakeOrderId', 'parentId', 'phoneToken', 'pointId', 'productId', 'productIds', 'productSlug', 'productSlugs', 'receiptId', 'refCode', 'referrerUserId', 'refreshToken', 'reportId', 'requestId', 'sessionId', 'shiftId', 'slot', 'src', 'staffId', 'staffUserId', 'storefrontId', 'storefrontSlug', 'tag', 'tagSlugs', 'targetId', 'templateId', 'tierId', 'unmatchedId', 'upToId', 'userId', 'variationId', 'wasteRequestId', 'zaloAccessToken']),
  ...exempt("tham số lọc, sắp xếp, phân trang: do ứng dụng dựng từ nút bấm, không phải ô nhập (gồm cả bộ lọc dạng chuỗi/enum như invoice, pancake)", ['after', 'at', 'before', 'by', 'cursor', 'filter', 'group', 'kind', 'mode', 'order', 'platform', 'queue', 'seed', 'segment', 'segments', 'sort', 'source', 'state', 'tier', 'track', 'via', 'visibility', 'attention', 'consignment', 'invoice', 'pancake', 'recycling', 'shopFault', 'reprice', 'unanswered']),
  ...exempt("khoá chặn ghi đè đồng thời (expected*), giá trị ứng dụng gửi lại đúng như đã hiển thị (acknowledgedWalletBalance) và mốc thời gian do ứng dụng dựng: người dùng không gõ", ['acknowledgedWalletBalance', 'editVersion', 'expected', 'expectedAmount', 'expectedPancakeCode', 'expectedPendingText', 'expectedRefund', 'expectedTotal', 'expectedUpdatedAt', 'expectedWalletBalance', 'occurredAt', 'overrideWalletBalance', 'seenAt', 'seenChangedAt', 'sourceWeekStart', 'targetWeekStart']),
  ...exempt("sự kiện đo lường và ngữ cảnh do ứng dụng điền", ['appVersion', 'campaign', 'consentVersion', 'contentType', 'context', 'entrySource', 'eventName', 'events', 'history', 'match', 'productUrl', 'props', 'scopeMeta', 'termsVersion']),
  ...exempt("mã chọn từ danh sách có sẵn (tỉnh, quận, phường), enum và bộ lọc do ứng dụng dựng, không có ô gõ tự do", ['action', 'addSource', 'brand', 'communeCode', 'districtCode', 'forSegment', 'payment', 'paymentUnlinked', 'periodKey', 'provinceCode', 'purchasedLimit', 'targetType', 'wardCode']),
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function loadAllValidatedFiles(): void {
  for (const file of walk(SRC)) {
    if (/from 'class-validator'/.test(readFileSync(file, 'utf8'))) require(file);
  }
}

/** Trả về "tên trường → các DTO chứa nó" cho mọi trường có luật kiểm tra mà chưa có nhãn. */
function missingLabels(): Map<string, Set<string>> {
  loadAllValidatedFiles();
  const metas = (getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; target: unknown; type: string }>> }).validationMetadatas;
  const missing = new Map<string, Set<string>>();
  for (const list of metas.values()) {
    for (const m of list) {
      if (m.type === 'whitelistValidation' || m.type === 'conditionalValidation') continue;
      if (FIELD_LABELS[m.propertyName] || EXEMPT[m.propertyName]) continue;
      const dto = (m.target as { name?: string }).name ?? String(m.target);
      if (!missing.has(m.propertyName)) missing.set(m.propertyName, new Set());
      missing.get(m.propertyName)!.add(dto);
    }
  }
  return missing;
}

describe('FIELD_LABELS phủ mọi trường DTO', () => {
  it('mọi trường có luật class-validator đều có nhãn hoặc nằm trong danh sách miễn', () => {
    const missing = [...missingLabels()].map(([field, dtos]) => `${field} ← ${[...dtos].sort().join(', ')}`).sort();
    expect(missing).toEqual([]);
  });

  it('danh sách miễn không chứa tên đã có nhãn', () => {
    expect(Object.keys(EXEMPT).filter((k) => FIELD_LABELS[k])).toEqual([]);
  });
});

describe('nhóm miễn "cờ đúng/sai" chỉ chứa trường thật sự là boolean', () => {
  it('mọi trường trong nhóm có @IsBoolean (hoặc @Equals cho ô đồng ý) ở mọi DTO chứa nó', () => {
    loadAllValidatedFiles();
    const metas = (getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; target: unknown; name?: string; type: string }>> }).validationMetadatas;
    const flags = new Set(Object.entries(EXEMPT).filter(([, reason]) => reason === FLAG_REASON).map(([name]) => name));
    const notBoolean: string[] = [];
    for (const list of metas.values()) {
      const byProp = new Map<string, string[]>();
      for (const m of list) byProp.set(m.propertyName, [...(byProp.get(m.propertyName) ?? []), m.name ?? m.type]);
      for (const [prop, names] of byProp) {
        if (flags.has(prop) && !names.some((n) => n === 'isBoolean' || n === 'equals')) notBoolean.push(`${prop} ← ${((list[0]!.target as { name?: string }).name) ?? '?'} (${names.join(', ')})`);
      }
    }
    expect([...new Set(notBoolean)].sort()).toEqual([]);
  });
});

describe('FIELD_LABELS_BY_DTO: nhãn riêng theo DTO', () => {
  it('mỗi mục trỏ tới một DTO có thật và trường có luật kiểm tra trong DTO đó', () => {
    loadAllValidatedFiles();
    const metas = (getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; target: unknown }>> }).validationMetadatas;
    const fieldsByClass = new Map<string, Set<string>>();
    for (const list of metas.values()) {
      for (const m of list) {
        const name = (m.target as { name?: string }).name ?? '';
        fieldsByClass.set(name, (fieldsByClass.get(name) ?? new Set()).add(m.propertyName));
      }
    }
    const bad: string[] = [];
    for (const [dto, fields] of Object.entries(FIELD_LABELS_BY_DTO)) {
      const known = fieldsByClass.get(dto);
      if (!known) bad.push(`${dto}: không có DTO này`);
      else for (const f of Object.keys(fields)) if (!known.has(f)) bad.push(`${dto}.${f}: DTO không có trường này`);
    }
    expect(bad).toEqual([]);
  });

  it('mục theo DTO khác nhãn toàn cục (không thì thừa)', () => {
    const same = Object.entries(FIELD_LABELS_BY_DTO).flatMap(([dto, fields]) => Object.entries(fields).filter(([f, l]) => FIELD_LABELS[f] === l).map(([f]) => `${dto}.${f}`));
    expect(same).toEqual([]);
  });
});

/** Class dùng nhãn chung của trường có nhãn riêng ở nơi khác: phải khai ở đây kèm lý do, để class mới (kế thừa, PartialType) không rơi im lặng về nhãn chung. */
const COMMON_LABEL_OK: Record<string, Record<string, string>> = {
  CreateFaqDto: { category: 'form FAQ ở màn quản trị ghi "Nhóm"' },
  UpdateFaqDto: { category: 'form FAQ ở màn quản trị ghi "Nhóm"' },
  CreateQuickReplyDto: { category: 'form Trả lời nhanh ở màn quản trị ghi "Nhóm"' },
  UpdateQuickReplyDto: { category: 'form Trả lời nhanh ở màn quản trị ghi "Nhóm"' },
  AdminListQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ExternalClaimListQueryDto: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ExternalOrderListQueryDto: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  FeedQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ListCategoryProductsQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ListCommissionRatesQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ListCouponsQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ListCustomerRefundsQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  OrderListQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ProductQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ProductSearchQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  ReturnRequestsQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  StorefrontAdminListQueryDto: { q: 'ô tìm kiếm ghi "Từ khoá"' },
  SuggestQuery: { q: 'ô tìm kiếm ghi "Từ khoá"' },
};

describe('trường có nhãn riêng theo DTO không rơi im lặng về nhãn chung', () => {
  it('class nào có trường nằm trong FIELD_LABELS_BY_DTO mà không có dòng riêng thì phải khai trong COMMON_LABEL_OK kèm lý do', () => {
    loadAllValidatedFiles();
    const metas = (getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; target: unknown }>> }).validationMetadatas;
    const perDtoFields = new Set(Object.values(FIELD_LABELS_BY_DTO).flatMap((f) => Object.keys(f)));
    const unlisted: string[] = [];
    for (const list of metas.values()) {
      for (const m of list) {
        const dto = (m.target as { name?: string }).name ?? '';
        if (!perDtoFields.has(m.propertyName)) continue;
        if (FIELD_LABELS_BY_DTO[dto]?.[m.propertyName] || COMMON_LABEL_OK[dto]?.[m.propertyName]) continue;
        unlisted.push(`${dto}.${m.propertyName}`);
      }
    }
    expect([...new Set(unlisted)].sort()).toEqual([]);
  });

  it('không có class nào dẫn xuất từ DTO có nhãn riêng (extends, mixin kiểu PartialType/PickType/OmitType/IntersectionType, qua biến trung gian) mà tự không có dòng trong bảng', () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      for (const h of findDerivedDtos(readFileSync(file, 'utf8'), Object.keys(FIELD_LABELS_BY_DTO))) {
        if (!FIELD_LABELS_BY_DTO[h.derived]) hits.push(`${h.derived} dẫn xuất từ ${h.owner} (${file.slice(SRC.length + 1)})`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('mục COMMON_LABEL_OK trỏ tới class và trường có thật, có lý do, và không trùng bảng theo DTO', () => {
    loadAllValidatedFiles();
    const metas = (getMetadataStorage() as unknown as { validationMetadatas: Map<unknown, Array<{ propertyName: string; target: unknown }>> }).validationMetadatas;
    const real = new Set<string>();
    for (const list of metas.values()) for (const m of list) real.add(`${(m.target as { name?: string }).name}.${m.propertyName}`);
    const bad: string[] = [];
    for (const [dto, fields] of Object.entries(COMMON_LABEL_OK)) {
      for (const [f, reason] of Object.entries(fields)) {
        if (!real.has(`${dto}.${f}`)) bad.push(`${dto}.${f}: không có trong DTO`);
        if (reason.trim().length < 8) bad.push(`${dto}.${f}: thiếu lý do`);
        if (FIELD_LABELS_BY_DTO[dto]?.[f]) bad.push(`${dto}.${f}: đã có nhãn riêng`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** Class dẫn xuất từ một trong `owners`: `extends` trực tiếp, bọc nhiều tầng bằng hàm mixin, hoặc qua `const Base = …(Owner…)`. */
function findDerivedDtos(text: string, owners: string[]): Array<{ derived: string; owner: string }> {
  const tainted = new Map<string, string>(owners.map((o) => [o, o]));
  const mentions = (expr: string) => [...tainted].find(([name]) => new RegExp(`\\b${name}\\b`).test(expr));
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of text.matchAll(/\bconst\s+(\w+)\s*=\s*([^;]*);/g)) {
      const hit = tainted.has(m[1]!) ? undefined : mentions(m[2]!);
      if (hit) {
        tainted.set(m[1]!, hit[1]);
        changed = true;
      }
    }
  }
  const out: Array<{ derived: string; owner: string }> = [];
  for (const m of text.matchAll(/\bclass\s+(\w+)\s+extends\s+([^{]*)\{/g)) {
    const hit = mentions(m[2]!);
    if (hit) out.push({ derived: m[1]!, owner: hit[1] });
  }
  return out;
}

describe('findDerivedDtos', () => {
  const owners = ['ProductQuery'];
  const derived = (t: string) => findDerivedDtos(t, owners).map((h) => h.derived);
  it('extends trực tiếp', () => expect(derived('class A extends ProductQuery {}')).toEqual(['A']));
  it('mixin một tầng', () => expect(derived('class A extends PartialType(ProductQuery) {}')).toEqual(['A']));
  it('mixin nhiều tầng và IntersectionType', () => {
    expect(derived("class A extends PartialType(PickType(ProductQuery, ['category'] as const)) {}")).toEqual(['A']);
    expect(derived('class B extends IntersectionType(Other, ProductQuery) {}')).toEqual(['B']);
  });
  it('qua biến trung gian, kể cả biến của biến', () => {
    expect(derived('const Base = PartialType(ProductQuery);\nclass A extends Base {}')).toEqual(['A']);
    expect(derived('const Base = PartialType(ProductQuery);\nconst Mid = OmitType(Base, [] as const);\nclass A extends Mid {}')).toEqual(['A']);
  });
  it('không bắt class không liên quan hay tên chỉ chứa tên DTO', () => {
    expect(derived('class A extends Other {}')).toEqual([]);
    expect(derived('class A extends ProductQueryExtra {}')).toEqual([]);
  });
});
