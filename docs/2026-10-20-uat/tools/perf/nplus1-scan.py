#!/usr/bin/env python3
"""Quét tĩnh N+1: vòng for/for-of/.map(async)/.forEach(async) mà thân vòng có `await` gọi prisma/tx/service.
Dùng: nplus1-scan.py <thư mục src> > out.txt. Chỉ là bộ lọc thô: mỗi dòng phải được đọc tay.
In: file:dòng-vòng | loại | các dòng await trong thân (file:dòng: văn bản)."""
import os, re, sys
root = sys.argv[1]
loop_rx = re.compile(r'^\s*(?:for\s*(?:await\s*)?\(|while\s*\()|\.map\(\s*async|\.forEach\(\s*async|Promise\.all\(\s*[\w.\[\]()]+\.map\(')
await_rx = re.compile(r'await\s+(?:this\.)?(?:prisma|tx|client|db|[a-zA-Z]+\.(?:prisma|tx))\b|await\s+tx\.|await\s+this\.[a-zA-Z]+\.[a-zA-Z]+\(|await\s+this\.prisma|await\s+prisma\.')
prisma_rx = re.compile(r'(prisma|tx)\.[a-zA-Z]+\.(find|count|update|create|delete|upsert|aggregate|groupBy)|\$queryRaw|\$executeRaw')
out = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        if not f.endswith('.ts') or f.endswith('.spec.ts') or '.int-spec' in f: continue
        p = os.path.join(dp, f)
        try: lines = open(p, encoding='utf8').read().split('\n')
        except Exception: continue
        for i, line in enumerate(lines):
            if not loop_rx.search(line): continue
            # lấy thân bằng đếm ngoặc từ dòng vòng
            depth = 0; started = False; body = []
            for j in range(i, min(len(lines), i + 80)):
                l = lines[j]
                for ch in l:
                    if ch in '({': depth += 1; started = True
                    elif ch in ')}': depth -= 1
                body.append((j + 1, l))
                if started and depth <= 0: break
            hits = [(n, l.strip()[:140]) for n, l in body if re.search(r'\bawait\b', l) and (prisma_rx.search(l) or await_rx.search(l))]
            if hits:
                out.append((p, i + 1, line.strip()[:100], hits))
for p, n, l, hits in sorted(out):
    print(f'{os.path.relpath(p, root)}:{n} | {l}')
    for hn, ht in hits[:4]: print(f'      {hn}: {ht}')
print(f'# tổng {len(out)} vòng', file=sys.stderr)
