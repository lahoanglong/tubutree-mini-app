import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { FIELD_LABELS } from './validation-pipe';

/**
 * Lỗi 400 hiện nguyên văn message[0] cho khách/admin: trường không có nhãn sẽ hiện «Trường «companyName»».
 * Spec duyệt metadata class-validator của mọi DTO trong src và đòi mỗi tên trường có nhãn tiếng Việt, hoặc nằm
 * trong danh sách miễn bên dưới (kèm lý do).
 */
const SRC = join(__dirname, '..');

/** Trường người dùng không gõ chữ vào: lý do nằm ở chuỗi đầu của từng nhóm. */
const exempt = (reason: string, names: string[]): Record<string, string> => Object.fromEntries(names.map((n) => [n, reason]));
const EXEMPT: Record<string, string> = {
  ...exempt("cờ đúng/sai do công tắc hoặc hộp chọn gửi lên; lỗi chỉ có thể là sai kiểu, không do người dùng gõ", ['acceptWalletForfeit', 'acknowledgedWalletBalance', 'active', 'allowDuplicate', 'approve', 'approved', 'attention', 'blocked', 'changedAfterApproval', 'confirmDirectProducts', 'confirmTakeover', 'confirmedNoWaybill', 'consent', 'consignment', 'debtOnly', 'disabled', 'enabled', 'giftHandoverEnabled', 'guests', 'hazardous', 'inStock', 'invoice', 'isActive', 'isDefault', 'isEmergency', 'isFeatured', 'isGreeting', 'isHidden', 'isPartner', 'isPinned', 'isPublished', 'isVerified', 'isVisible', 'listed', 'missing', 'missingImage', 'newCustomerOnly', 'notifyGarden', 'notifyPromo', 'onSale', 'overdue', 'packagingConsent', 'pancake', 'paused', 'perkPending', 'phoneMatchConfirmed', 'pinned', 'postagePaidConsent', 'quotedZeroTotal', 'recycling', 'reprice', 'shipLocked', 'shopFault', 'storefront', 'takeOver', 'tubuFulfils', 'unanswered', 'uncategorized']),
  ...exempt("khoá kỹ thuật: id, danh sách id, token, mã tham chiếu hệ thống do ứng dụng điền, không có ô nhập", ['accessToken', 'addressId', 'anchorProductId', 'anonymousId', 'beforeId', 'brandId', 'card', 'categoryId', 'categoryIds', 'clientMsgId', 'codeVerifier', 'collectionId', 'deviceId', 'eventId', 'expectedTakeoverProductId', 'groupId', 'id', 'ids', 'itemId', 'itemIds', 'key', 'link', 'locationToken', 'memberId', 'merchantId', 'notificationId', 'orderId', 'orderItemId', 'orderedIds', 'ownerUserId', 'pancakeOrderId', 'parentId', 'phoneToken', 'pointId', 'productId', 'productIds', 'productSlug', 'productSlugs', 'receiptId', 'refCode', 'referrerUserId', 'refreshToken', 'reportId', 'requestId', 'sessionId', 'shiftId', 'slot', 'src', 'staffId', 'staffUserId', 'storefrontId', 'storefrontSlug', 'tag', 'tagSlugs', 'targetId', 'templateId', 'tierId', 'unmatchedId', 'upToId', 'userId', 'variationId', 'wasteRequestId', 'zaloAccessToken']),
  ...exempt("tham số lọc, sắp xếp, phân trang: do ứng dụng dựng từ nút bấm, không phải ô nhập", ['after', 'at', 'before', 'by', 'cursor', 'filter', 'group', 'kind', 'mode', 'order', 'platform', 'queue', 'seed', 'segment', 'segments', 'sort', 'source', 'state', 'tier', 'track', 'via', 'visibility']),
  ...exempt("khoá chặn ghi đè đồng thời (expected*) và mốc thời gian do ứng dụng dựng: người dùng không gõ", ['editVersion', 'expected', 'expectedAmount', 'expectedPancakeCode', 'expectedPendingText', 'expectedRefund', 'expectedTotal', 'expectedUpdatedAt', 'expectedWalletBalance', 'occurredAt', 'overrideWalletBalance', 'seenAt', 'seenChangedAt', 'sourceWeekStart', 'targetWeekStart']),
  ...exempt("sự kiện đo lường và ngữ cảnh do ứng dụng điền", ['appVersion', 'campaign', 'consentVersion', 'contentType', 'context', 'entrySource', 'eventName', 'events', 'history', 'match', 'productUrl', 'props', 'scopeMeta', 'termsVersion']),
  ...exempt("mã chọn từ danh sách có sẵn (tỉnh, quận, phường), enum và bộ lọc do ứng dụng dựng, không có ô gõ tự do", ['action', 'addSource', 'brand', 'communeCode', 'districtCode', 'forSegment', 'payment', 'paymentUnlinked', 'periodKey', 'provinceCode', 'purchasedLimit', 'slugs', 'targetType', 'wardCode']),
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
