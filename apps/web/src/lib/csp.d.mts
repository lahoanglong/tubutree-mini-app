export declare const CSP_REPORT_GROUP: string;
export function cspReportUrl(apiBaseUrl: string | undefined): string;
export function buildCsp(opts: { apiBaseUrl: string | undefined; sentryConnect?: string; dev?: boolean; frameAncestors?: string }): {
  policy: string;
  reportingEndpoints: string;
};
