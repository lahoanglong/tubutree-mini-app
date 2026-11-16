export interface WpProduct {
  slug: string;
  name?: string;
  price?: number | null;
  attributes?: Array<{ name: string; terms: string[] }>;
  variations?: Array<{ attributes?: Array<{ name: string; value: string }>; price: number | null }>;
}
export interface CatalogProduct {
  slug: string;
  name: string;
  brand?: string | null;
  basePrice?: number;
  salePrice?: number | null;
  inStock?: boolean;
  variations?: Array<{ name: string; price: number }>;
}
export interface MapDecision {
  slug: string;
  title: string;
  kind: 'exact' | 'fuzzy' | 'variant' | 'tie' | 'review' | 'none';
  score: number;
  product?: string;
  curated?: string;
  rule?: string;
  tied?: string[];
  candidates: Array<{ slug: string; score: number; priceMatch: boolean; volumeUnverified: boolean }>;
}
export interface HitRow {
  path: string;
  slug: string;
  count: number;
  kind: 'pdp' | 'search' | 'all' | 'none';
  target: string | null;
  via: 'map' | 'table' | null;
}
export const DEFAULT_PATHS: { wp: string; catalog: string; hits: string; out: string; redirects: string };
export const AUTO_MIN: number;
export const REVIEW_MIN: number;
export const HITS_DAY: string;
export function fold(text: string): string;
export function volumesWithIndex(text: string): Array<{ key: string; index: number }>;
export function volumes(text: string): string[];
export function tokens(text: string): string[];
export function slugBase(slug: string): string;
export function buildProductMap(input: { wpProducts: WpProduct[]; catalog: CatalogProduct[]; extraSlugs?: string[]; curated?: Readonly<Record<string, string>> }): {
  map: Record<string, string>;
  decisions: MapDecision[];
};
export function classifyHits(
  hits: Record<string, number>,
  map: Readonly<Record<string, string>>,
  curated: Readonly<Record<string, string>>,
): { rows: HitRow[]; total: number; pdp: number; search: number; all: number; none: number };
export function slugsFromHits(...hitTables: Array<Record<string, number>>): string[];
export function parseArgs(argv: string[]): {
  wp: string;
  catalog: string;
  hits: string;
  out: string;
  redirects: string;
  write: boolean;
  check: boolean;
  report: string;
  fetchCatalog: string;
  fetchWp: string;
  help: boolean;
};
export function loadInputs(opts: { wp: string; catalog: string; hits: string }): {
  wpProducts: WpProduct[];
  catalog: CatalogProduct[];
  hits: Record<string, number>;
  extraSlugs: string[];
};
