import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as ts from 'typescript';
import { join } from 'node:path';
import { TEMPLATE_VARIABLES, VARIABLE_LABELS, templateVariableProblem, variablesOf } from './notification-variables';

type SeedTemplate = { code: string; bodyTemplate: string };

function seededTemplates(): SeedTemplate[] {
  const src = readFileSync(join(__dirname, '../../../prisma/seed.ts'), 'utf-8');
  const start = src.indexOf('const NOTIFICATION_TEMPLATES = [');
  const open = src.indexOf('[', src.indexOf('=', start));
  const end = src.indexOf('\n];', open);
  return new Function(`return ${src.slice(open, end + 2)};`)() as SeedTemplate[];
}

const usedIn = (body: string) => [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];

const KNOWN_OUTSIDE_TABLE: string[] = [];

describe('Biến của mẫu thông báo', () => {
  const seeded = seededTemplates();

  it('bảng biến phủ đúng các mẫu mặc định, không thừa không thiếu', () => {
    expect(Object.keys(TEMPLATE_VARIABLES).sort()).toEqual(seeded.map((t) => t.code).sort());
  });

  it.each(seeded.map((t) => [t.code, t] as const))('%s: mọi biến của nội dung mặc định có trong bảng', (_code, t) => {
    for (const v of usedIn(t.bodyTemplate)) expect(TEMPLATE_VARIABLES[t.code]).toContain(v);
    expect(templateVariableProblem(t.code, t.bodyTemplate)).toBe('');
  });

  it('mọi biến đều có tên gọi dễ hiểu', () => {
    const keys = new Set(Object.values(TEMPLATE_VARIABLES).flat());
    for (const k of keys) expect(VARIABLE_LABELS[k]).toBeTruthy();
  });

  it('mẫu mã giảm giá chào mừng liệt kê đúng biến, không có mã đơn hàng', () => {
    expect(variablesOf('WELCOME_VOUCHER')!.map((v) => v.key).sort()).toEqual(['code', 'expires', 'min_order_note', 'value']);
    expect(variablesOf('WELCOME_VOUCHER')!.map((v) => v.key)).not.toContain('order_code');
  });

  it('mẫu ngoài bảng không kiểm được (null)', () => {
    expect(variablesOf('MAU_TU_THEM')).toBeNull();
    expect(templateVariableProblem('MAU_TU_THEM', 'Xin chào {{bat_ky}}')).toBe('');
  });

  describe('templateVariableProblem', () => {
    it('biến mã không điền cho mẫu này: báo tên biến và danh sách dùng được', () => {
      const p = templateVariableProblem('WELCOME_VOUCHER', 'Tặng mã {{order_code}}');
      expect(p).toContain('{{order_code}}');
      expect(p).toContain('{{code}}');
      expect(p).toContain('{{value}}');
    });

    it.each([
      ['dấu cách', 'Mã {{ code }}'],
      ['có dấu tiếng Việt', 'Mã {{mã}}'],
      ['viết hoa sai', 'Mã {{Code}}'],
      ['ngoặc đơn', 'Mã {code}'],
      ['biến trống', 'Mã {{}}'],
    ])('lỗi gõ: %s', (_l, body) => {
      expect(templateVariableProblem('WELCOME_VOUCHER', body)).not.toBe('');
    });

    it('nội dung hợp lệ và không biến đều qua', () => {
      expect(templateVariableProblem('WELCOME_VOUCHER', 'Tặng bạn mã {{code}} giảm {{value}}, dùng trước {{expires}}.')).toBe('');
      expect(templateVariableProblem('GAME_TREE_THIRSTY', 'Cây đang khát, ghé tưới nhé!')).toBe('');
    });

    it('mẫu không có biến mà gõ biến thì báo "không có biến nào"', () => {
      expect(templateVariableProblem('GAME_TREE_THIRSTY', 'Cây của {{user}} khát')).toContain('không có biến nào');
    });
  });
});


/**
 * Đối chiếu với chỗ gọi: mọi biến mà mã điền cho một mẫu phải có trong bảng, nếu không admin không thêm được biến đó vào câu dù mã đã điền.
 * Dò ba dạng: `notify(user, MÃ, { ... })` / `notifySafe(n, user, MÃ, { ... })`, và object `{ template|templateCode: MÃ, data: ... }`.
 * MÃ có thể là chuỗi, nhánh `a ? 'X' : 'Y'`, hằng thành viên như `CTV_NOTIFICATION.NEW` hay hằng cùng tên ở file khác. Dữ liệu có thể là
 * object literal hoặc biến cục bộ `const data = { ... }` (kèm `data.khoá = ...`). Chỗ KHÔNG giải mã được tĩnh phải có trong
 * DYNAMIC_SITES kèm lý do (và nếu khai `codes` thì khoá của object literal ở đó vẫn được kiểm cho TỪNG mã, không dựa vào nội dung seed); chỗ chưa liệt kê làm spec đỏ.
 */
describe('Bảng biến khớp các chỗ gọi notify()', () => {
  const INTERNAL_KEYS = new Set(['post_id', 'route', 'product_slug']);
  const SRC = join(__dirname, '../..');
  // Tên hàm → vị trí của mã mẫu trong danh sách tham số (dữ liệu ngay sau đó). notifyOwner / notifyMerchantOwner là hàm bọc chuyển tiếp xuống notify().
  const NOTIFY_CALLS: Record<string, number> = { notify: 1, notifySafe: 2, notifyOwner: 1, notifyMerchantOwner: 4 };

  /** Hàm bọc cố định mã mẫu: tên hàm → mã và vị trí tham số dữ liệu. */
  const FIXED_CODE_CALLS: Record<string, { code: string; dataAt: number }> = {
    notifyBonusAdjustedAfterCommit: { code: 'DEALER_BONUS_ADJUSTED', dataAt: 2 },
  };

  /** Chỗ gọi không giải mã được tĩnh: `tệp|đoạn mã của mã mẫu` (hoặc `|data: đoạn mã dữ liệu`) → lý do, và `codes` nếu biết mã nào đi qua. */
  const DYNAMIC_SITES: Record<string, { reason: string; codes?: string[] }> = {
    'modules/dealer/dealer.service.ts|code': { reason: 'Hàm gửi báo đại lý nhận mã mẫu làm tham số (DEALER_REWARD_CLAIM_*); chỗ gọi truyền chuỗi cùng object literal.', codes: ['DEALER_REWARD_CLAIM_NEW', 'DEALER_REWARD_CLAIM_APPROVED', 'DEALER_REWARD_CLAIM_REJECTED', 'DEALER_REWARD_CLAIM_PAID'] },
    'modules/dealer/dealer.service.ts|\'DEALER_BONUS_ADJUSTED\'|data:data': { reason: 'Gửi sau commit; dữ liệu là tham số của notifyBonusAdjustedAfterCommit, được dò ở chỗ gọi hàm đó (FIXED_CODE_CALLS).' },
    'modules/external-points/external-claim-status.ts|code': { reason: 'notifySafe chuyển tiếp mã và dữ liệu của người gọi; chỗ gọi notifySafe được dò (NOTIFY_CALLS).' },
    'modules/feed/community-feed.service.ts|template': { reason: 'Hàm gửi báo tác giả nhận mã (thích/bình luận) và hàm tạo dữ liệu bất đồng bộ làm tham số; chỗ gọi truyền chuỗi và thunk.', codes: ['COMMUNITY_POST_LIKED', 'COMMUNITY_POST_COMMENTED'] },
    'modules/integrations/gomdon/gomdon-alert.service.ts|template': { reason: 'Tham số template của alert() (mặc định OPS_GOMDON_ALERT hoặc OPS_PANCAKE_ALERT), dữ liệu { order_code, message } ngay tại chỗ.', codes: ['OPS_GOMDON_ALERT', 'OPS_PANCAKE_ALERT'] },
    'modules/merchant/merchant-fulfilment.service.ts|template': { reason: 'Hàm bọc notifyOwner chuyển tiếp mã và dữ liệu của người gọi; chỗ gọi notifyOwner được dò (NOTIFY_CALLS).' },
    'modules/ops/cron-run.service.ts|template': { reason: 'Bộ chuyển tiếp cho notifyAdmins; chỗ gọi notifyAdmins được dò theo dạng { template, data }.' },
    'modules/orders/merchant-order-notify.ts|template': { reason: 'Hàm bọc notifyMerchantOwner chuyển tiếp mã và dữ liệu của người gọi; chỗ gọi hàm đó được dò (NOTIFY_CALLS).' },
    'modules/orders/order-status.service.ts|opts.notifyEvent ?? `ORDER_${targetStatus}`': { reason: 'Mã theo trạng thái đơn (ORDER_<trạng thái>) hoặc mã người gọi chỉ định; dữ liệu là biến cục bộ notifyData cùng khoá cho mọi mã.', codes: ['ORDER_CONFIRMED', 'ORDER_PACKED', 'ORDER_SHIPPING', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'ORDER_RETURNED'] },
    'modules/orders/order-status.service.ts|`ORDER_${order.status}`': { reason: 'Mã theo trạng thái đơn đã đóng (huỷ hoặc trả); dữ liệu là object literal tại chỗ.', codes: ['ORDER_CANCELLED', 'ORDER_RETURNED'] },
    'modules/storefront/storefront-admin.service.ts|template': { reason: 'Hàm bọc notifyOwner chuyển tiếp mã và dữ liệu của người gọi; chỗ gọi notifyOwner được dò (NOTIFY_CALLS).' },
    'modules/wallet/referral-notify.ts|templateCode': { reason: 'Mã và dữ liệu do referralNoticeMessage trả về; các object { templateCode, data } trong hàm đó được dò theo dạng { templateCode, data }.' },
    'common/notify-admins.ts|notice.template': { reason: 'Hàm chuyển tiếp mẫu và dữ liệu của người gọi; chỗ gọi notifyAdmins được dò theo dạng { template, data }.' },
    'modules/vouchers/vouchers.service.ts|opts.templateCode': {
      reason: 'Hàm dùng chung cho mọi loại mã giảm giá; mã mẫu do người gọi truyền (templateCode) và dữ liệu là object literal ngay tại chỗ.',
      codes: ['WELCOME_VOUCHER', 'BIRTHDAY_VOUCHER', 'WINBACK_VOUCHER', 'MILESTONE_VOUCHER', 'SECOND_ORDER_VOUCHER'],
    },
  };

  /**
   * Khoá mà chỗ gọi điền chung cho cả các nhánh `a ? 'X' : 'Y'` (hoặc nhiều mã đi qua cùng một object) nhưng mẫu của mã này không
   * dùng nên cố ý không có trong bảng của mã đó: mã → khoá.
   */
  const FILLED_NOT_LISTED: Record<string, string[]> = {
    DEALER_APPLICATION_APPROVED: ['reason'],
    DEALER_APPLICATION_REJECTED: ['tier'],
    MERCHANT_PRODUCT_APPROVED: ['reason'],
    MERCHANT_PRODUCT_EDIT_APPROVED: ['reason'],
    CHAT_ORDER_POINTS_CREDITED: ['code'],
    COMMUNITY_EXPERT_REPLIED: ['author'],
    ORDER_CONFIRMED: ['points_note', 'refund_note'],
    ORDER_PACKED: ['points_note', 'refund_note'],
    ORDER_SHIPPING: ['points_note', 'refund_note'],
    ORDER_DELIVERED: ['refund_note'],
    ORDER_CANCELLED: ['points_note'],
    ORDER_RETURNED: ['points_note'],
  };

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) sourceFiles(p, out);
      else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.race-spec.ts')) out.push(p);
    }
    return out;
  }

  const files = sourceFiles(SRC).map((file) => {
    const text = readFileSync(file, 'utf-8');
    return { file, rel: file.slice(SRC.length + 1), text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
  });

  const unwrap = (n: ts.Node | undefined): ts.Node | undefined => {
    let cur = n;
    while (cur && (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isNonNullExpression(cur))) cur = cur.expression;
    return cur;
  };

  /** Hằng chuỗi: `const A = 'X'` → A, `const M = { K: 'X' }` → M.K. Trùng tên khác giá trị thì bỏ (không giải mã được). */
  const CONSTS = (() => {
    const map = new Map<string, string | null>();
    const set = (k: string, v: string) => map.set(k, map.has(k) && map.get(k) !== v ? null : v);
    for (const { sf } of files) {
      const visit = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
          const init = unwrap(n.initializer);
          if (init && ts.isStringLiteral(init)) set(n.name.text, init.text);
          else if (init && ts.isObjectLiteralExpression(init)) {
            for (const p of init.properties) {
              const v = ts.isPropertyAssignment(p) ? unwrap(p.initializer) : undefined;
              if (v && ts.isStringLiteral(v) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) set(`${n.name.text}.${p.name.text}`, v.text);
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return map;
  })();

  /** Khai báo `const name = ...` gần nhất, tìm từ hàm bao quanh ra ngoài. */
  const localInit = (id: ts.Identifier): ts.Expression | null => {
    let scope: ts.Node | undefined = id.parent;
    while (scope) {
      if (ts.isFunctionLike(scope) || ts.isSourceFile(scope)) {
        let found: ts.Expression | null = null;
        const visit = (c: ts.Node): void => {
          if (found) return;
          if (ts.isVariableDeclaration(c) && ts.isIdentifier(c.name) && c.name.text === id.text && c.initializer) found = c.initializer;
          else if (c !== scope && ts.isFunctionLike(c)) return;
          else ts.forEachChild(c, visit);
        };
        ts.forEachChild(scope, visit);
        if (found) return found;
      }
      scope = scope.parent;
    }
    return null;
  };

  /** Các mã mẫu mà biểu thức có thể mang; null nếu không giải mã được tĩnh. */
  const codesOf = (e: ts.Node | undefined): string[] | null => {
    const n = unwrap(e);
    if (!n) return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
    if (ts.isConditionalExpression(n)) {
      const a = codesOf(n.whenTrue);
      const b = codesOf(n.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    if (ts.isPropertyAccessExpression(n) || ts.isIdentifier(n)) {
      // Chỉ tên hằng viết hoa (CTV_NOTIFICATION.NEW, OPS_PAYMENT_TEMPLATE): tên thường như `code` trùng khắp nơi, đi theo khai báo cục bộ.
      const v = /^[A-Z][A-Z0-9_]*(\.\w+)?$/.test(n.getText()) ? CONSTS.get(n.getText()) : undefined;
      if (typeof v === 'string') return [v];
      const init = ts.isIdentifier(n) ? localInit(n) : null;
      return init ? codesOf(init) : null;
    }
    return null;
  };

  const keyName = (p: ts.ObjectLiteralElementLike, sf: ts.SourceFile) => (p.name ? p.name.getText(sf).replace(/['"]/g, '') : null);

  /** Khoá của object literal, hoặc của biến cục bộ `const x = {...}` kèm các `x.khoá = ...` trong cùng hàm; null nếu không giải mã được. */
  const keysOf = (e: ts.Node | undefined, sf: ts.SourceFile): string[] | null => {
    const n = unwrap(e);
    if (!n) return null;
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (!ts.isBlock(n.body)) return keysOf(unwrap(n.body) as ts.Node, sf);
      const ret = n.body.statements.find((st): st is ts.ReturnStatement => ts.isReturnStatement(st));
      return ret?.expression ? keysOf(ret.expression, sf) : null;
    }
    if (ts.isObjectLiteralExpression(n)) return n.properties.flatMap((p) => (ts.isSpreadAssignment(p) ? [] : [keyName(p, sf)!])).filter(Boolean);
    if (!ts.isIdentifier(n)) return null;
    const init = localInit(n);
    const base = init ? keysOf(init, sf) : null;
    if (!base) return null;
    // Khoá gán thêm sau đó: `x.khoá = ...` / `x['khoá'] = ...` trong cùng hàm với chỗ dùng.
    let scope: ts.Node = n;
    while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;
    const extra: string[] = [];
    const visit = (c: ts.Node): void => {
      if (ts.isBinaryExpression(c) && c.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const l = c.left;
        if (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) && l.expression.text === n.text) extra.push(l.name.text);
        if (ts.isElementAccessExpression(l) && ts.isIdentifier(l.expression) && l.expression.text === n.text && ts.isStringLiteral(l.argumentExpression)) extra.push(l.argumentExpression.text);
      }
      ts.forEachChild(c, visit);
    };
    visit(scope);
    return [...base, ...extra];
  };

  interface Found { code: string; key: string; site: string }
  const scan = () => {
    const filled: Found[] = [];
    const undecodable: { site: string; id: string; reason: string }[] = [];
    const dynamicHit = new Set<string>();
    for (const { rel, sf } of files) {
      const where = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
      const record = (codeExpr: ts.Node | undefined, dataExpr: ts.Node | undefined, at: ts.Node) => {
        const cs = codesOf(codeExpr);
        const ks = keysOf(dataExpr, sf);
        if (cs && ks) {
          for (const code of cs) for (const key of ks) filled.push({ code, key, site: where(at) });
          return;
        }
        const codeId = `${rel}|${codeExpr?.getText(sf)}`;
        const id = cs ? `${codeId}|data:${dataExpr?.getText(sf)}` : codeId;
        const dyn = DYNAMIC_SITES[id];
        if (!dyn) return void undecodable.push({ site: where(at), id, reason: cs ? 'dữ liệu không giải mã được tĩnh' : 'mã mẫu không giải mã được tĩnh' });
        dynamicHit.add(id);
        const declared = dyn.codes ?? [];
        for (const c of declared) for (const key of ks ?? []) filled.push({ code: c, key, site: where(at) });
      };
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const c = n.expression;
          const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : null;
          const at = name ? NOTIFY_CALLS[name] : undefined;
          const fixed = name ? FIXED_CODE_CALLS[name] : undefined;
          if (at !== undefined && n.arguments.length > at + 1) record(n.arguments[at], n.arguments[at + 1], n);
          else if (fixed && n.arguments.length > fixed.dataAt) {
            const keys = keysOf(n.arguments[fixed.dataAt], sf);
            if (keys) for (const key of keys) filled.push({ code: fixed.code, key, site: where(n) });
          }
        } else if (ts.isObjectLiteralExpression(n)) {
          const tpl = n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && /^(template|templateCode)$/.test(p.name.getText(sf)));
          const data = n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && /^(data|vars|variables|params)$/.test(p.name.getText(sf)));
          if (tpl && data && codesOf(tpl.initializer)) record(tpl.initializer, data.initializer, n);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return { filled, undecodable, dynamicHit };
  };

  const result = scan();

  it('không có biến nào mã điền mà bảng thiếu', () => {
    expect(result.filled.length).toBeGreaterThan(80);
    // Chỗ chọn mã bằng `a ? 'X' : 'Y'` điền chung một object, nhưng từng mã phải có đủ khoá mà chỗ đó điền, trừ những cặp ghi rõ trong
    // FILLED_NOT_LISTED (khoá chỉ một nhánh dùng). Không dựa vào nội dung mẫu seed.
    const missing = result.filled.filter(
      (f) => TEMPLATE_VARIABLES[f.code] && !INTERNAL_KEYS.has(f.key) && !f.key.endsWith('_id') && !TEMPLATE_VARIABLES[f.code]!.includes(f.key) && !FILLED_NOT_LISTED[f.code]?.includes(f.key),
    );
    expect(missing).toEqual([]);
  });

  it('FILLED_NOT_LISTED không còn mục thừa: khoá vẫn được điền ở đâu đó và vẫn chưa có trong bảng của mã', () => {
    for (const [code, keys] of Object.entries(FILLED_NOT_LISTED)) {
      for (const key of keys) {
        expect({ code, key, filled: result.filled.some((f) => f.code === code && f.key === key) }).toEqual({ code, key, filled: true });
        expect({ code, key, listed: TEMPLATE_VARIABLES[code]?.includes(key) }).toEqual({ code, key, listed: false });
      }
    }
  });

  it('mã mẫu điền ở chỗ gọi đều có trong bảng (hoặc là mẫu tự thêm ngoài bảng)', () => {
    const unknown = [...new Set(result.filled.filter((f) => !TEMPLATE_VARIABLES[f.code]).map((f) => `${f.code} @ ${f.site}`))];
    // Mẫu ngoài bảng (không có trong seed) không kiểm được; liệt kê để một mã gõ sai không âm thầm lọt.
    expect(unknown).toEqual(KNOWN_OUTSIDE_TABLE);
  });

  it('mọi chỗ không giải mã được tĩnh đều đã khai trong DYNAMIC_SITES kèm lý do', () => {
    const missing = result.undecodable.filter((u) => !DYNAMIC_SITES[u.id]);
    expect(missing.map((u) => `${u.site} ${u.id} (${u.reason})`)).toEqual([]);
  });

  it('DYNAMIC_SITES không còn mục thừa (chỗ gọi đã đổi hay đã giải mã được)', () => {
    const seen = new Set([...result.undecodable.map((u) => u.id), ...result.dynamicHit]);
    expect(Object.keys(DYNAMIC_SITES).filter((k) => !seen.has(k))).toEqual([]);
    for (const [k, v] of Object.entries(DYNAMIC_SITES)) expect({ k, reason: v.reason.length > 10 }).toEqual({ k, reason: true });
  });

  it('bốn biến mã điền mà trước đây bảng thiếu', () => {
    expect(TEMPLATE_VARIABLES.GROUP_BUY_SUCCESS).toEqual(expect.arrayContaining(['code', 'expires', 'product']));
    expect(TEMPLATE_VARIABLES.GAME_CHECKIN_REMINDER).toContain('freezes');
    expect(TEMPLATE_VARIABLES.REFERRAL_REWARD_REVOKED).toEqual(expect.arrayContaining(['points', 'debt']));
    expect(TEMPLATE_VARIABLES.DEALER_CREDIT_PAYMENT_REPORTED).toContain('note');
  });

  it('mã giảm giá sinh nhật, kéo khách quay lại, cột mốc điền min_order_note (vouchers.service.ts) nên bảng có biến này', () => {
    for (const code of ['BIRTHDAY_VOUCHER', 'WINBACK_VOUCHER', 'MILESTONE_VOUCHER']) expect(TEMPLATE_VARIABLES[code]).toContain('min_order_note');
  });

  it('dò đúng chỗ dùng hằng thành viên (CTV_NOTIFICATION) và nhánh a ? X : Y', () => {
    const codesSeen = new Set(result.filled.map((f) => f.code));
    for (const c of ['COMMISSION_NEW', 'COMMISSION_APPROVED', 'DEALER_APPLICATION_APPROVED', 'DEALER_APPLICATION_REJECTED', 'MERCHANT_PRODUCT_APPROVED', 'MERCHANT_PRODUCT_REJECTED', 'REFERRAL_REWARD_PAID', 'REFERRAL_REWARD_REVOKED', 'DEALER_BONUS_ADJUSTED', 'COMMUNITY_NEW_ANSWER', 'COMMUNITY_EXPERT_REPLIED', 'BIRTHDAY_VOUCHER']) {
      expect(codesSeen.has(c)).toBe(true);
    }
  });
});
