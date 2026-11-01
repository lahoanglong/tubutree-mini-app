/** Danh mục cha → các con trực tiếp, từ các dòng `{ id, parentId }`. */
export function childrenByParent(rows: readonly { id: string; parentId: string | null }[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = children.get(r.parentId) ?? [];
    list.push(r.id);
    children.set(r.parentId, list);
  }
  return children;
}

/** `[id, ...mọi con cháu]` của một danh mục; id lạ hoặc danh mục lá trả `[id]`. Có `visited` nên vòng `parentId` không treo. */
export function expandCategoryScope(children: ReadonlyMap<string, string[]>, id: string): string[] {
  const scope = [id];
  const visited = new Set(scope);
  for (let i = 0; i < scope.length; i++) {
    for (const child of children.get(scope[i]!) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      scope.push(child);
    }
  }
  return scope;
}
