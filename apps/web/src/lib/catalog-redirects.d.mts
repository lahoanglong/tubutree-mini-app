export interface CatalogRedirect {
  source: string;
  has: { type: 'query'; key: string }[];
  destination: string;
  permanent: false;
}
export function buildCatalogRedirects(): CatalogRedirect[];
