export interface MiniappRedirect {
  source: string;
  destination: string;
  permanent: false;
}
export function buildMiniappRedirects(
  groups: ReadonlyArray<{ items: ReadonlyArray<{ miniapp: string; web?: string }> }>,
): MiniappRedirect[];
