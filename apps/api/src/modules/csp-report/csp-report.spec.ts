import { CSP_LOG_MAX_LINES_PER_WINDOW, CSP_LOG_WINDOW_MS, CspLogGate, MAX_VIOLATIONS_PER_REPORT, normalizeCspReports } from './csp-report';

describe('normalizeCspReports', () => {
  it('application/csp-report: bỏ query và fragment của blocked-uri, chỉ giữ path của document-uri', () => {
    const out = normalizeCspReports({
      'csp-report': {
        'document-uri': 'https://tubutree.vn/gio-hang?token=abc#x',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example.com/a/b.js?session=secret#frag',
      },
    });
    expect(out).toEqual([{ directive: 'script-src-elem', blocked: 'https://evil.example.com/a/b.js', document: '/gio-hang' }]);
  });

  it('application/reports+json: mảng csp-violation, bỏ phần tử loại khác', () => {
    const out = normalizeCspReports([
      { type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://cdn.example.com/x.png?a=1', documentURL: 'https://tubutree.vn/?q=1' } },
      { type: 'deprecation', body: { id: 'x' } },
      { type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'inline', documentURL: 'https://tubutree.vn/a' } },
    ]);
    expect(out).toEqual([
      { directive: 'img-src', blocked: 'https://cdn.example.com/x.png', document: '/' },
      { directive: 'script-src', blocked: 'inline', document: '/a' },
    ]);
  });

  it('từ khoá không phải URL (eval, data:) giữ gọn; ký tự điều khiển bị thay để không chèn dòng log', () => {
    const [a] = normalizeCspReports({ 'csp-report': { 'violated-directive': 'script-src\nFAKE LINE', 'blocked-uri': 'data:text/html;base64,AAAA', 'document-uri': 'https://x.vn/p' } });
    expect(a!.blocked).toBe('data:');
    expect(a!.directive).not.toMatch(/[\r\n]/);
    const [b] = normalizeCspReports({ 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'eval' } });
    expect(b).toMatchObject({ blocked: 'eval', document: '' });
  });

  it('sai dạng hoặc thiếu directive → rỗng; mảng quá dài bị cắt', () => {
    expect(normalizeCspReports(null)).toEqual([]);
    expect(normalizeCspReports('x')).toEqual([]);
    expect(normalizeCspReports({ 'csp-report': 'x' })).toEqual([]);
    expect(normalizeCspReports({ 'csp-report': { 'blocked-uri': 'x' } })).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: `https://a.example/${i}`, documentURL: 'https://x.vn/' } }));
    expect(normalizeCspReports(many)).toHaveLength(MAX_VIOLATIONS_PER_REPORT);
  });
});

describe('CspLogGate', () => {
  const v = (n: number | string) => ({ directive: 'img-src', blocked: `https://a.example/${n}`, document: '/' });

  it('trùng trong cùng cửa sổ chỉ ghi một lần, sang cửa sổ mới ghi lại kèm số đã lược', () => {
    let t = 1_000_000;
    const gate = new CspLogGate(() => t);
    expect(gate.admit(v(1))).toEqual({ log: true, summary: 0 });
    expect(gate.admit(v(1))).toEqual({ log: false, summary: 0 });
    expect(gate.admit(v(1))).toEqual({ log: false, summary: 0 });
    t += CSP_LOG_WINDOW_MS;
    expect(gate.admit(v(1))).toEqual({ log: true, summary: 2 });
  });

  it('khoá khác nhau vẫn bị trần số dòng mỗi cửa sổ', () => {
    const gate = new CspLogGate(() => 5_000_000);
    const logged = Array.from({ length: CSP_LOG_MAX_LINES_PER_WINDOW + 20 }, (_, i) => gate.admit(v(i)).log).filter(Boolean);
    expect(logged).toHaveLength(CSP_LOG_MAX_LINES_PER_WINDOW);
  });
});
