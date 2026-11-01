export interface DsComponent {
  name: string;
  miniapp: string;
  web: string;
  props?: string;
  propsDiff?: { miniOnly?: string[]; webOnly?: string[]; reason: string };
  screens?: string[];
}
export interface DsMap {
  components: DsComponent[];
  webOnly: { name: string; web: string; reason: string }[];
  upcoming: { name: string; package: string; wave: string; note?: string }[];
}
export function exportsSymbol(source: string, name: string): boolean;
export function propKeys(source: string, typeName: string): string[] | null;
export function checkDsParity(input: { map: DsMap; miniappRoutes: string[]; readFile: (repoRelativePath: string) => string | null }): { errors: string[]; warnings: string[] };
