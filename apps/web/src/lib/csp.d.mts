export const CSP_REPORT_GROUP: string;
export function cspReportUrl(apiBaseUrl: string | undefined): string;
export function buildCsp(opts: { apiBaseUrl: string | undefined; sentryConnect?: string; dev?: boolean }): {
  policy: string;
  reportingEndpoints: string;
};
