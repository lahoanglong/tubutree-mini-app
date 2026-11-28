export interface SubmissionFiles {
  /** Nội dung tệp (đường dẫn tính từ gốc repo), null khi không có. */
  read(path: string): string | null;
  /** Mọi tệp dưới thư mục, đường dẫn tính từ gốc repo. */
  list(dir: string): string[];
}
export interface SubmissionCheck {
  group: string;
  id: string;
  ok: boolean;
  detail: string;
}
export const MINI_SRC: string;
export const APP_CORE_SRC: string;
export const FILES: Record<
  | 'appConfig'
  | 'permissions'
  | 'bridge'
  | 'legalCore'
  | 'webPolicy'
  | 'about'
  | 'checkout'
  | 'orderConsent'
  | 'webLegalPage'
  | 'appRoutes'
  | 'navConfig'
  | 'profileMenu'
  | 'settings'
  | 'deletionSection'
  | 'accountApiCore'
  | 'usersController'
  | 'consentWebhook'
  | 'checkoutRules'
  | 'webPortalScreens'
  | 'webPortalRedirect',
  string
>;
export const SCOPES_OF_API: Record<string, string[]>;
export const FORBIDDEN_SDK_APIS: string[];
export const ALLOWED_HOSTS: Record<string, string>;
export const PAYMENT_HOSTS: string[];
export const ALLOWED_PAYMENT_METHODS: string[];
export const WEB_SHOPPING_PATHS: string[];
export const BROWSER_ONLY_WEB_PATHS: string[];
export function isShippedSource(path: string): boolean;
export function diskFiles(root: string): SubmissionFiles;
export function checkSubmission(files: SubmissionFiles): { checks: SubmissionCheck[]; failed: number };
