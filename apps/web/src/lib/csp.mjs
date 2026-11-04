/** Tên endpoint báo cáo trong header Reporting-Endpoints, chỉ thị `report-to` trỏ tới tên này. */
export const CSP_REPORT_GROUP = 'csp-endpoint';

/** Nơi API nhận báo cáo vi phạm (POST /api/csp-report). URL API rỗng, tương đối hoặc không phải http(s) thì không có. */
export function cspReportUrl(apiBaseUrl) {
  try {
    const base = new URL(apiBaseUrl ?? '');
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return '';
    return `${base.origin}${base.pathname.replace(/\/+$/, '')}/csp-report`;
  } catch {
    return '';
  }
}

/**
 * Chính sách CSP (Report-Only) của web và header Reporting-Endpoints đi kèm.
 * Chrome gửi báo cáo theo `report-to` (Reporting API, application/reports+json) và bỏ qua `report-uri` khi có cả hai; Firefox và Safari
 * chỉ hiểu `report-uri` (application/csp-report). API nhận cả hai dạng.
 * `'unsafe-eval'` chỉ cho bản dev: `next dev` chạy mã qua eval (source map, Fast Refresh), bản build production thì không.
 */
export function buildCsp({ apiBaseUrl, sentryConnect = '', dev = false }) {
  let apiOrigin = '';
  try {
    apiOrigin = new URL(apiBaseUrl ?? '').origin;
  } catch {
    apiOrigin = '';
  }
  const reportUrl = cspReportUrl(apiBaseUrl);
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: https://res.cloudinary.com",
    `connect-src 'self'${apiOrigin && apiOrigin !== 'null' ? ` ${apiOrigin}` : ''} https://api.cloudinary.com${sentryConnect ? ` ${sentryConnect}` : ''}`,
    ...(reportUrl ? [`report-uri ${reportUrl}`, `report-to ${CSP_REPORT_GROUP}`] : []),
  ];
  return {
    policy: directives.join('; '),
    reportingEndpoints: reportUrl ? `${CSP_REPORT_GROUP}="${reportUrl}"` : '',
  };
}
