export interface CatalogRedirect {
  source: string;
  has: { type: 'query'; key: string }[];
  missing: { type: 'host'; value: string }[];
  destination: string;
  permanent: false;
}
export function buildCatalogRedirects(rootDomain?: string): CatalogRedirect[];
