import { itemSummary, nameTokens, RECIPIENT_PAYLOAD_KEY, recipientFingerprint, recipientNameMatch } from './claim-trust-signals';
import { payloadForStorage } from './external-order.mapper';

const SECRET = 'test-secret-w45';
const fp = (name: string, field: 'ship' | 'bill' = 'ship') =>
  recipientFingerprint(field === 'ship' ? { shipping_address: { full_name: name } } : { bill_full_name: name }, SECRET);
const match = (orderName: string, memberName: string | null) => recipientNameMatch(fp(orderName), memberName, SECRET);

describe('nameTokens', () => {
  it('bỏ dấu, viết thường, bỏ ký tự lạ, không trùng; chữ bị che bỏ đi và đánh dấu masked', () => {
    expect(nameTokens('  Nguyễn Thị  Hoà ')).toEqual({ tokens: ['nguyen', 'thi', 'hoa'], masked: false });
    expect(nameTokens('Đặng Đức-Anh')).toEqual({ tokens: ['dang', 'duc', 'anh'], masked: false });
    expect(nameTokens('N***n Văn A**')).toEqual({ tokens: ['van'], masked: true });
    expect(nameTokens('L•••')).toBeNull();
    expect(nameTokens('')).toBeNull();
    expect(nameTokens(42)).toBeNull();
  });
});

describe('recipientFingerprint', () => {
  it('chỉ mã băm 12 hex từng chữ đã sắp xếp, không còn chữ nào của tên; cùng khoá cho cùng kết quả', () => {
    const out = fp('Nguyễn Văn Bình');
    expect(out?.t).toHaveLength(3);
    for (const h of out!.t) expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect([...out!.t].sort()).toEqual(out!.t);
    expect(JSON.stringify(out)).not.toMatch(/nguyen|van|binh|Bình/i);
    expect(fp('BÌNH văn NGUYỄN')).toEqual(out);
    expect(recipientFingerprint({ shipping_address: { full_name: 'Nguyễn Văn Bình' } }, 'khoá khác')).not.toEqual(out);
  });

  it('tên giao hàng trước, tên hoá đơn sau; không có tên thì null', () => {
    expect(recipientFingerprint({ shipping_address: { full_name: 'Lan' }, bill_full_name: 'Minh' }, SECRET)).toEqual(fp('Lan'));
    expect(recipientFingerprint({ shipping_address: { full_name: '  ' }, bill_full_name: 'Minh' }, SECRET)).toEqual(fp('Minh'));
    expect(fp('Minh', 'bill')).toEqual(fp('Minh'));
    expect(recipientFingerprint({ customer: { name: 'Zalo Name' } }, SECRET)).toBeNull();
    expect(recipientFingerprint({}, SECRET)).toBeNull();
  });

  it('tên bị che một phần: giữ chữ còn thấy, đánh dấu m = 1', () => {
    expect(fp('Trần T** Mai')).toEqual({ t: expect.any(Array), m: 1 });
  });

  it('payloadForStorage ghi dấu vân tay, không ghi tên', () => {
    const kept = payloadForStorage({ id: '1', shipping_address: { full_name: 'Phạm Thu Trang', phone_number: '0912345678' }, bill_full_name: 'Phạm Thu Trang' });
    expect(kept[RECIPIENT_PAYLOAD_KEY]).toEqual({ t: expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{12}$/)]) });
    expect(JSON.stringify(kept)).not.toMatch(/Trang|Thu|Phạm|0912345678/);
    expect(payloadForStorage({ id: '2' })[RECIPIENT_PAYLOAD_KEY]).toBeUndefined();
  });
});

describe('recipientNameMatch', () => {
  it('MATCH: cùng tập chữ dù khác dấu, hoa thường, thứ tự', () => {
    expect(match('Nguyễn Văn Bình', 'nguyen van binh')).toBe('MATCH');
    expect(match('Bình Nguyễn Văn', 'Nguyễn Văn Bình')).toBe('MATCH');
  });

  it('PARTIAL: trùng chữ riêng (tên gọi) dù tên Zalo ngắn hay viết ngược', () => {
    expect(match('Nguyễn Thị Hoa', 'Hoa Nguyễn')).toBe('PARTIAL');
    expect(match('Lê Minh Tuấn', 'Tuấn')).toBe('PARTIAL');
  });

  it('chỉ trùng họ phổ biến hay chữ lót thì là MISMATCH', () => {
    expect(match('Nguyễn Văn Nam', 'Nguyễn Thị Lan')).toBe('MISMATCH');
    expect(match('Trần Thị Mai', 'Bé Na')).toBe('MISMATCH');
  });

  it('tên bị che: trùng chữ riêng còn thấy là PARTIAL (không bao giờ MATCH), không trùng thì NO_DATA', () => {
    expect(recipientNameMatch(fp('Trần T** Mai'), 'Trần Thị Mai', SECRET)).toBe('PARTIAL');
    expect(recipientNameMatch(fp('Nguyễn V** B***'), 'Nguyễn Văn Bình', SECRET)).toBe('NO_DATA');
    expect(recipientNameMatch(fp('Nguyễn V** B***'), 'Lê Thu', SECRET)).toBe('NO_DATA');
  });

  it('NO_DATA: đơn chưa có dấu vân tay (nạp trước W45), dữ liệu lạ, thành viên không có tên', () => {
    expect(recipientNameMatch(undefined, 'Lan', SECRET)).toBe('NO_DATA');
    expect(recipientNameMatch(null, 'Lan', SECRET)).toBe('NO_DATA');
    expect(recipientNameMatch({ t: 'x' }, 'Lan', SECRET)).toBe('NO_DATA');
    expect(recipientNameMatch([], 'Lan', SECRET)).toBe('NO_DATA');
    expect(match('Lan', null)).toBe('NO_DATA');
    expect(match('Lan', '   ')).toBe('NO_DATA');
  });

  it('khoá khác (đổi bí mật) không bao giờ ra MATCH', () => {
    expect(recipientNameMatch(fp('Nguyễn Văn Bình'), 'Nguyễn Văn Bình', 'khoá mới')).toBe('MISMATCH');
  });
});

describe('itemSummary', () => {
  const item = (quantity: unknown, retail: unknown, discount?: unknown) => ({ quantity, discount_each_product: discount, variation_info: { retail_price: retail } });

  it('tổng sản phẩm, số dòng, giá đã trừ giảm mỗi món; một dòng không ghi số dòng', () => {
    expect(itemSummary([item(2, 150000, 10000), item(1, 89000)])).toBe('3 sản phẩm, 2 dòng: 2 × 140.000đ, 1 × 89.000đ');
    expect(itemSummary([item(1, 1250000)])).toBe('1 sản phẩm: 1 × 1.250.000đ');
    expect(itemSummary([item('2', '99000')])).toBe('2 sản phẩm: 2 × 99.000đ');
  });

  it('quá 3 dòng thì gộp phần còn lại', () => {
    expect(itemSummary([item(1, 1000), item(1, 2000), item(1, 3000), item(2, 4000), item(1, 5000)])).toBe(
      '6 sản phẩm, 5 dòng: 1 × 1.000đ, 1 × 2.000đ, 1 × 3.000đ, +2 dòng',
    );
  });

  it('thiếu hay sai số thì null, không đoán', () => {
    expect(itemSummary(undefined)).toBeNull();
    expect(itemSummary([])).toBeNull();
    expect(itemSummary([item(0, 1000)])).toBeNull();
    expect(itemSummary([item(1.5, 1000)])).toBeNull();
    expect(itemSummary([item(1, null)])).toBeNull();
    expect(itemSummary([{ quantity: 1 }])).toBeNull();
    expect(itemSummary('x')).toBeNull();
  });
});
