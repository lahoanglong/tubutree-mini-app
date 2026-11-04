import {
  DEFAULT_VAT_INVOICE_HOSTS,
  hostMatches,
  isPrivateOrInternalHost,
  vatInvoiceHosts,
  vatInvoiceUrlError,
} from './vat-invoice-url';

describe('vatInvoiceHosts', () => {
  it('env trống/undefined/chỉ dấu phẩy → dùng mặc định', () => {
    expect(vatInvoiceHosts('')).toEqual([...DEFAULT_VAT_INVOICE_HOSTS]);
    expect(vatInvoiceHosts(undefined)).toEqual([...DEFAULT_VAT_INVOICE_HOSTS]);
    expect(vatInvoiceHosts(' , ,')).toEqual([...DEFAULT_VAT_INVOICE_HOSTS]);
  });
  it('env có giá trị THAY danh sách mặc định, trim + chữ thường + bỏ mục rỗng', () => {
    expect(vatInvoiceHosts(' *.Foo.VN , bar.com ,,')).toEqual(['*.foo.vn', 'bar.com']);
  });
  it('mục env dán cả link, có dấu chấm cuối, hoặc tách bằng chấm phẩy/khoảng trắng vẫn ra tên miền đúng', () => {
    expect(vatInvoiceHosts('https://a.meinvoice.vn/tra-cuu?x=1; meinvoice.vn.  *.ehoadon.vn\nHTTP://B.vn#x')).toEqual([
      'a.meinvoice.vn',
      'meinvoice.vn',
      '*.ehoadon.vn',
      'b.vn',
    ]);
    expect(vatInvoiceUrlError('https://a.meinvoice.vn/x', vatInvoiceHosts('https://a.meinvoice.vn/'))).toBeNull();
  });
  it('mục env kèm cổng hoặc tài khoản (`user@`) vẫn ra tên miền đúng', () => {
    expect(vatInvoiceHosts('meinvoice.vn:443, user:pw@b.vn, https://u@c.vn:8443/x, *.d.vn:443, e.vn:')).toEqual([
      'meinvoice.vn',
      'b.vn',
      'c.vn',
      '*.d.vn',
      'e.vn',
    ]);
    expect(vatInvoiceUrlError('https://abc.d.vn/x', vatInvoiceHosts('*.d.vn:443'))).toBeNull();
  });
  it('mặc định có kho lưu trữ của hệ thống', () => {
    expect(DEFAULT_VAT_INVOICE_HOSTS).toContain('res.cloudinary.com');
    expect(DEFAULT_VAT_INVOICE_HOSTS).toContain('drive.google.com');
  });
});

describe('hostMatches', () => {
  it('*.x khớp x và tên miền con, không khớp host chỉ trùng đuôi chữ', () => {
    expect(hostMatches('meinvoice.vn', '*.meinvoice.vn')).toBe(true);
    expect(hostMatches('abc.meinvoice.vn', '*.meinvoice.vn')).toBe(true);
    expect(hostMatches('a.b.meinvoice.vn', '*.meinvoice.vn')).toBe(true);
    expect(hostMatches('evilmeinvoice.vn', '*.meinvoice.vn')).toBe(false);
    expect(hostMatches('meinvoice.vn.evil.com', '*.meinvoice.vn')).toBe(false);
  });
  it('mục không có * khớp đúng tên', () => {
    expect(hostMatches('drive.google.com', 'drive.google.com')).toBe(true);
    expect(hostMatches('x.drive.google.com', 'drive.google.com')).toBe(false);
  });
});

describe('isPrivateOrInternalHost', () => {
  it.each([
    'localhost', 'a.localhost', '127.0.0.1', '127.9.9.9', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '[::1]', '::1', '[fe80::1]', '[fc00::1]', '[fd12::1]', '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '[::ffff:c0a8:101]', 'db.internal', 'printer.local',
  ])('%s là nội bộ', (h) => expect(isPrivateOrInternalHost(h)).toBe(true));
  it.each(['172.15.0.1', '172.32.0.1', '8.8.8.8', 'abc.meinvoice.vn', '[2606:4700::1111]', 'localhost.evil.com'])('%s không phải nội bộ', (h) =>
    expect(isPrivateOrInternalHost(h)).toBe(false),
  );
});

describe('vatInvoiceUrlError (mặc định)', () => {
  const ok = (u: string) => expect(vatInvoiceUrlError(u)).toBeNull();
  const blocked = (u: string, re?: RegExp) => expect(vatInvoiceUrlError(u)).toMatch(re ?? /./);

  it.each(DEFAULT_VAT_INVOICE_HOSTS.map((p) => (p.startsWith('*.') ? p.slice(2) : p)))('host mặc định %s (và tên miền con nếu có *) qua', (base) => {
    ok(`https://${base}/hd.pdf`);
  });
  it.each(DEFAULT_VAT_INVOICE_HOSTS.filter((p) => p.startsWith('*.')).map((p) => p.slice(2)))('%s: tên miền con qua, host giả mạo bị chặn', (base) => {
    ok(`https://abc.${base}/x`);
    // sinvoice.viettel.vn là con của *.viettel.vn nên `evilsinvoice.viettel.vn` hợp lệ theo mục kia; chỉ thử với host gốc.
    if (base !== 'sinvoice.viettel.vn') blocked(`https://evil${base}/x`, /chưa được phép/);
    blocked(`https://${base}.evil.com/x`, /chưa được phép/);
  });
  it('ví dụ yêu cầu', () => {
    ok('https://abc.meinvoice.vn/x');
    ok('https://meinvoice.vn/x');
    blocked('https://evilmeinvoice.vn/x');
    blocked('https://meinvoice.vn.evil.com/x');
  });
  it('chữ hoa và dấu chấm cuối được chuẩn hoá', () => {
    ok('https://ABC.MeInvoice.VN/x');
    ok('https://abc.meinvoice.vn./x');
  });
  it('http, user:pass, cổng khác 443, không phải link → câu lỗi về dạng link', () => {
    blocked('http://abc.meinvoice.vn/x', /https/);
    blocked('https://user:pw@abc.meinvoice.vn/x', /https/);
    blocked('https://abc.meinvoice.vn:8443/x', /https/);
    blocked('không phải link', /https/);
    blocked('javascript:alert(1)', /https/);
    ok('https://abc.meinvoice.vn:443/x');
  });
  it.each([
    'https://localhost/x', 'https://app.localhost/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://172.16.5.5/x', 'https://172.31.0.1/x',
    'https://192.168.0.10/x', 'https://169.254.169.254/latest', 'https://0.0.0.0/x', 'https://[::1]/x', 'https://[fe80::1]/x', 'https://[fc00::1]/x',
    'https://[::ffff:127.0.0.1]/x', 'https://svc.internal/x', 'https://nas.local/x', 'https://2130706433/x', 'https://0x7f.1/x',
  ])('địa chỉ nội bộ %s → báo nội bộ', (u) => blocked(u, /nội bộ/));
  it.each([
    'https://8.8.8.8/x', 'https://100.64.0.1/x', 'https://[::127.0.0.1]/x', 'https://[64:ff9b::a00:1]/x', 'https://[2002:7f00:1::]/x',
    'https://[fec0::1]/x', 'https://[2606:4700::1111]/x',
  ])('địa chỉ IP %s (công khai hoặc IPv6 nhúng IPv4) → báo phải dùng tên miền', (u) => blocked(u, /tên miền.*không dùng địa chỉ IP/));
  it('câu lỗi dạng link nói rõ chỉ dùng cổng 443', () => {
    blocked('https://abc.meinvoice.vn:8443/x', /chỉ dùng cổng mặc định \(443\)/);
  });
  it('ngoài danh sách: nêu tên miền và gợi ý ALLOWED_VAT_INVOICE_HOSTS', () => {
    blocked('https://Evil.Example.com./x', /evil\.example\.com.*ALLOWED_VAT_INVOICE_HOSTS/);
  });
  it('quá dài → lỗi dạng link', () => {
    blocked(`https://abc.meinvoice.vn/${'a'.repeat(500)}`, /https/);
  });
});

describe('vatInvoiceUrlError (tham số hosts)', () => {
  it('danh sách truyền vào thay mặc định', () => {
    expect(vatInvoiceUrlError('https://abc.meinvoice.vn/x', ['*.foo.vn'])).toMatch(/chưa được phép/);
    expect(vatInvoiceUrlError('https://abc.foo.vn/x', ['*.foo.vn'])).toBeNull();
  });
  it('env ALLOWED_VAT_INVOICE_HOSTS thay mặc định, trống thì dùng mặc định', () => {
    const prev = process.env.ALLOWED_VAT_INVOICE_HOSTS;
    try {
      process.env.ALLOWED_VAT_INVOICE_HOSTS = 'hoadon.mycorp.vn';
      expect(vatInvoiceUrlError('https://hoadon.mycorp.vn/x')).toBeNull();
      expect(vatInvoiceUrlError('https://abc.meinvoice.vn/x')).toMatch(/chưa được phép/);
      process.env.ALLOWED_VAT_INVOICE_HOSTS = '';
      expect(vatInvoiceUrlError('https://abc.meinvoice.vn/x')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.ALLOWED_VAT_INVOICE_HOSTS;
      else process.env.ALLOWED_VAT_INVOICE_HOSTS = prev;
    }
  });
  it('allowlist không cứu được địa chỉ nội bộ hay địa chỉ IP', () => {
    expect(vatInvoiceUrlError('https://127.0.0.1/x', ['127.0.0.1'])).toMatch(/nội bộ/);
    expect(vatInvoiceUrlError('https://8.8.8.8/x', ['8.8.8.8'])).toMatch(/địa chỉ IP/);
  });
});
