import { describe, expect, it } from 'vitest';
import { fillPastedText, matchPastedWard, parseAddressPaste, type GeoOption } from './address-paste';

const HCM = { code: '84_VN79', name: 'Thành phố Hồ Chí Minh' };
const HN = { code: '84_VN01', name: 'Thành phố Hà Nội' };
const DN = { code: '84_VN75', name: 'Tỉnh Đồng Nai' };
const PROVINCES: GeoOption[] = [HCM, HN, DN, { code: '84_VN48', name: 'Thành phố Đà Nẵng' }, { code: '84_VN46', name: 'Thành phố Huế' }];

const parse = (s: string, list: readonly GeoOption[] = PROVINCES) => parseAddressPaste(s, list);

describe('parseAddressPaste', () => {
  it('khối Zalo 3 dòng có dấu', () => {
    expect(parse('Nguyễn Văn An\n0912 345 678\n123 Lê Lợi, Phường Bến Thành, Quận 1, TP.HCM')).toEqual({
      recipient: 'Nguyễn Văn An',
      phone: '0912345678',
      street: '123 Lê Lợi',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('một dòng ngăn bằng gạch, SĐT +84 có dấu cách', () => {
    const r = parse('Trần Thị Bình - +84 903 456 789 - 45/2 Nguyễn Trãi, P. Bến Thành, Q.1, Hồ Chí Minh');
    expect(r).toMatchObject({ recipient: 'Trần Thị Bình', phone: '0903456789', street: '45/2 Nguyễn Trãi', province: HCM });
    expect(r?.ward).toEqual({ kind: 'p', name: 'Bến Thành' });
  });

  it('có nhãn Tên/SĐT/Địa chỉ, HN viết tắt, bỏ cấp quận', () => {
    expect(parse('Tên: Lê Hoa\nSĐT: 0987.654.321\nĐịa chỉ: 12 Hàng Bài, P. Hoàn Kiếm, Q. Hoàn Kiếm, HN')).toEqual({
      recipient: 'Lê Hoa',
      phone: '0987654321',
      street: '12 Hàng Bài',
      province: HN,
      ward: { kind: 'p', name: 'Hoàn Kiếm' },
    });
  });

  it('không dấu, không dấu phẩy', () => {
    expect(parse('nguyen van an 0912345678 123 le loi p ben thanh q1 hcm')).toEqual({
      recipient: 'nguyen van an',
      phone: '0912345678',
      street: '123 le loi',
      province: HCM,
      ward: { kind: 'p', name: 'ben thanh' },
    });
  });

  it('tiền tố dính dấu chấm: P.Bến Thành, TP.HCM', () => {
    expect(parse('Chị Mai, 0909123456, 8 Pasteur, P.Bến Thành, TP.HCM')).toMatchObject({
      recipient: 'Chị Mai',
      street: '8 Pasteur',
      province: HCM,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
  });

  it('bỏ thành phố cấp quận đã giải thể (TP Thủ Đức)', () => {
    expect(parse('Anh Tú Lê\n0911222333\n5 Võ Văn Ngân, P. Linh Chiểu, TP Thủ Đức, TP Hồ Chí Minh')).toMatchObject({
      street: '5 Võ Văn Ngân',
      province: HCM,
      ward: { kind: 'p', name: 'Linh Chiểu' },
    });
  });

  it('SĐT 0084 và (+84)', () => {
    expect(parse('Lê Hùng 0084 912 345 678, 12 Lê Lợi, HCM')?.phone).toBe('0912345678');
    expect(parse('Lê Hùng (+84) 912345678, 12 Lê Lợi, HCM')?.phone).toBe('0912345678');
  });

  it('bỏ đuôi Việt Nam', () => {
    expect(parse('Lê Hùng, 0912345678, 12 Lê Lợi, Phường Sài Gòn, TP. Hồ Chí Minh, Việt Nam')).toMatchObject({
      street: '12 Lê Lợi',
      province: HCM,
      ward: { kind: 'p', name: 'Sài Gòn' },
    });
  });

  it('SĐT ở cuối, không có tên', () => {
    expect(parse('123 Lê Lợi, P. Bến Thành, Q1, HCM 0912345678')).toMatchObject({ recipient: '', phone: '0912345678', street: '123 Lê Lợi' });
  });

  it('tên ở dòng riêng sau địa chỉ, ngay trước SĐT', () => {
    expect(parse('12 Lê Lợi, Phường Sài Gòn, TP HCM\nNguyễn An\n0912345678')?.recipient).toBe('Nguyễn An');
  });

  it('tên dòng đầu đứng riêng, không có SĐT', () => {
    expect(parse('Nguyễn An\n12 Lê Lợi, Phường Sài Gòn, TP HCM')).toMatchObject({ recipient: 'Nguyễn An', phone: '', street: '12 Lê Lợi' });
  });

  it('chữ không đủ dáng địa chỉ thì null (để ô dán như thường)', () => {
    expect(parse('0912345678')).toBeNull();
    expect(parse('123 Lê Lợi')).toBeNull();
    expect(parse('giao giờ hành chính')).toBeNull();
    expect(parse('')).toBeNull();
    expect(parse('Số: 0912 345 678')).toBeNull();
    expect(parse('Gọi 0912345678')).toBeNull();
  });

  it('chữ quá dài (cả đoạn chat) thì null', () => {
    expect(parse(`Nguyễn An 0912345678 ${'12 Lê Lợi, '.repeat(60)}`)).toBeNull();
  });

  it('không dấu: "phuong anh" đứng đầu là tên, không phải phường', () => {
    expect(parse('phuong anh 0912345678 12 le loi p ben thanh hcm')).toMatchObject({ recipient: 'phuong anh', street: '12 le loi' });
  });

  it('Xa lộ Hà Nội là tên đường, không phải tỉnh hay xã', () => {
    expect(parse('Bảo Ngọc, 0912345678, 120 Xa lộ Hà Nội')).toMatchObject({ street: '120 Xa lộ Hà Nội', province: null, ward: null });
    expect(parse('bao ngoc 0912345678 120 xa lo ha noi')).toMatchObject({ street: '120 xa lo ha noi', province: null, ward: null });
  });

  it('"123 Đồng Nai" là đường; "…, Đồng Nai" đứng riêng là tỉnh', () => {
    expect(parse('Bảo Ngọc, 0912345678, 123 Đồng Nai')).toMatchObject({ street: '123 Đồng Nai', province: null });
    expect(parse('Bảo Ngọc, 0912345678, 12 Lê Lợi, Đồng Nai')).toMatchObject({ street: '12 Lê Lợi', province: DN });
  });

  it('"Huyền" có dấu không bị coi là "Huyện"', () => {
    expect(parse('Bảo Ngọc 0912345678 9 Huyền Trân Công Chúa')?.street).toBe('9 Huyền Trân Công Chúa');
  });

  it('phường viết trần không tiền tố trước cấp quận/tỉnh', () => {
    expect(parse('Bảo Ngọc, 0912345678, 12 Lê Lợi, Bến Thành, Q1, HCM')).toMatchObject({
      street: '12 Lê Lợi',
      ward: { kind: '', name: 'Bến Thành' },
    });
  });

  it('tổ/ấp giữ ở số nhà; huyện cũ viết trần sau xã bị bỏ', () => {
    expect(parse('Bảo Ngọc 0912345678\nTổ 5, Ấp 3, Xã Tân Thạnh Đông, Củ Chi, HCM')).toMatchObject({
      street: 'Tổ 5, Ấp 3',
      province: HCM,
      ward: { kind: 'x', name: 'Tân Thạnh Đông' },
    });
  });

  it('bỏ dòng Ghi chú', () => {
    const r = parse('Nguyễn An\n0912345678\n12 Lê Lợi, P. Sài Gòn, HCM\nGhi chú: giao giờ hành chính, gọi trước');
    expect(r?.street).toBe('12 Lê Lợi');
  });

  it('hai SĐT: lấy số đầu, số sau không lọt vào số nhà', () => {
    expect(parse('Nguyễn An 0912345678 / 0987654321, 12 Lê Lợi, P. Bến Thành, HCM')).toMatchObject({
      phone: '0912345678',
      street: '12 Lê Lợi',
    });
  });

  it('ký tự vô hình và dấu cách cứng của Zalo', () => {
    const zw = String.fromCharCode(0x200b);
    const nb = String.fromCharCode(0xa0);
    expect(parse(`Nguyễn An${zw}\n0912${nb}345${nb}678\n12 Lê Lợi, HCM`)).toMatchObject({ recipient: 'Nguyễn An', phone: '0912345678' });
  });

  it('danh mục tỉnh chưa tải: tên tỉnh viết tắt/đúng tên không lọt vào số nhà', () => {
    expect(parse('Nguyễn An 0912345678 12 Lê Lợi, P. Bến Thành, TP Hồ Chí Minh', [])).toMatchObject({
      street: '12 Lê Lợi',
      province: null,
      ward: { kind: 'p', name: 'Bến Thành' },
    });
    expect(parse('Nguyễn An 0912345678 12 Hàng Bài, Hà Nội', [])?.street).toBe('12 Hàng Bài');
  });

  it('đặc khu và thị trấn', () => {
    expect(parse('Nguyễn An 0912345678 12 Trần Hưng Đạo, Đặc khu Phú Quốc')?.ward).toEqual({ kind: 'd', name: 'Phú Quốc' });
    expect(parse('Nguyễn An 0912345678 12 Trần Hưng Đạo, Thị trấn Củ Chi, HCM')?.ward).toEqual({ kind: '', name: 'Củ Chi' });
  });

  it('phường số dính chữ: P12', () => {
    expect(parse('Nguyễn An 0912345678 12 Lê Lợi P12 Q3 HCM')).toMatchObject({ street: '12 Lê Lợi', ward: { kind: 'p', name: '12' } });
  });
});

describe('matchPastedWard', () => {
  const COMMUNES: GeoOption[] = [
    { code: 'w1', name: 'Phường Bến Thành' },
    { code: 'w2', name: 'Phường Tân Thạnh' },
    { code: 'w3', name: 'Xã Tân Thạnh' },
    { code: 'w4', name: 'Phường Phú Lâm' },
    { code: 'w5', name: 'Phường Phú Lăm' },
    { code: 'w6', name: 'Phường 1' },
  ];

  it('khớp không dấu, đúng một mục', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'ben thanh' })?.code).toBe('w1');
    expect(matchPastedWard(COMMUNES, { kind: '', name: 'Bến Thành' })?.code).toBe('w1');
  });

  it('phường/xã trùng tên: tiền tố quyết; không tiền tố thì không đoán', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'x', name: 'Tân Thạnh' })?.code).toBe('w3');
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Tân Thạnh' })?.code).toBe('w2');
    expect(matchPastedWard(COMMUNES, { kind: '', name: 'Tân Thạnh' })).toBeNull();
  });

  it('trùng khi bỏ dấu: chữ có dấu chọn đúng mục; không dấu thì null', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Phú Lâm' })?.code).toBe('w4');
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'phu lam' })).toBeNull();
  });

  it('phường số bỏ số 0 đầu', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: '01' })?.code).toBe('w6');
  });

  it('không khớp hay chữ rỗng thì null', () => {
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: 'Linh Chiểu' })).toBeNull();
    expect(matchPastedWard(COMMUNES, { kind: 'p', name: '  ' })).toBeNull();
  });

  it('nối với parseAddressPaste', () => {
    const r = parse('nguyen van an 0912345678 123 le loi p ben thanh q1 hcm');
    expect(r?.ward && matchPastedWard(COMMUNES, r.ward)?.code).toBe('w1');
  });
});

describe('fillPastedText', () => {
  const paste = { recipient: 'Lê Hoa', phone: '0987654321', street: '12 Hàng Bài', province: null, ward: null };

  it('chỉ điền ô trống khi không được đè', () => {
    expect(fillPastedText({ recipient: 'Tôi', phone: '', street: ' ' }, paste, () => false)).toEqual({
      recipient: 'Tôi',
      phone: '0987654321',
      street: '12 Hàng Bài',
    });
  });

  it('đè ô được phép (chưa do khách gõ)', () => {
    expect(fillPastedText({ recipient: 'Tôi', phone: '0900000000', street: '' }, paste, (k) => k === 'recipient').recipient).toBe('Lê Hoa');
  });

  it('không đổi gì thì trả đúng object cũ', () => {
    const form = { recipient: 'A', phone: 'B', street: 'C' };
    expect(fillPastedText(form, paste, () => false)).toBe(form);
  });

  it('cắt tên quá trần độ dài', () => {
    expect(fillPastedText({ recipient: '', phone: '', street: '' }, { ...paste, recipient: 'a'.repeat(200) }, () => false).recipient).toHaveLength(120);
  });
});
