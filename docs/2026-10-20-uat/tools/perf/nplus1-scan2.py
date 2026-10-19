#!/usr/bin/env python3
"""Quét tĩnh N+1 loại 2: callback .map/.flatMap/.forEach/for-of (không có await trực tiếp) chứa lời gọi prisma/service trong thân,
thường nằm trong Promise.all(arr.map(...)). Dùng: nplus1-scan2.py <src>. Bộ lọc thô, đọc tay từng dòng."""
import os, re, sys
root = sys.argv[1]
head = re.compile(r'\.(map|flatMap|forEach)\(\s*(?:async\s*)?\(?[\w, {}:\[\]]*\)?\s*=>')
call = re.compile(r'(?:this\.)?(?:prisma|tx|db)\.[a-zA-Z]+\.(?:find\w*|count|aggregate|groupBy)\(|\$queryRaw|this\.(?:[a-z]+Service|catalog|pricing|orders|loyalty|wallet|notifications|affiliate|config|flashSale|coupons|cart|checkout)\.[a-zA-Z]+\(')
res = []
for dp, dn, fn in os.walk(root):
    for f in fn:
        if not f.endswith('.ts') or f.endswith('.spec.ts'): continue
        p = os.path.join(dp, f)
        lines = open(p, encoding='utf8').read().split('\n')
        for i, line in enumerate(lines):
            if not head.search(line): continue
            depth = 0; started = False; body = []
            for j in range(i, min(len(lines), i + 40)):
                l = lines[j]
                for ch in l:
                    if ch in '({[': depth += 1; started = True
                    elif ch in ')}]': depth -= 1
                body.append((j + 1, l))
                if started and depth <= 0: break
            hits = [(n, l.strip()[:130]) for n, l in body if call.search(l)]
            if hits: res.append((os.path.relpath(p, root), i + 1, line.strip()[:100], hits))
for p, n, l, hits in sorted(res):
    print(f'{p}:{n} | {l}')
    for hn, ht in hits[:3]: print(f'      {hn}: {ht}')
print(f'# tổng {len(res)}', file=sys.stderr)
