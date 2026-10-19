#!/usr/bin/env python3
"""Tóm tắt các câu SQL chậm trong log Postgres 25434 (log_min_duration_statement=0) trong một khoảng giờ.
Dùng: slowlog.py <log> <HH:MM:SS bắt đầu> <HH:MM:SS kết thúc> [ngưỡng ms]
Chỉ tính dòng 'execute'. Gộp theo 90 ký tự đầu của câu (đã bỏ khoảng trắng thừa)."""
import re, sys, collections, statistics
log, t0, t1 = sys.argv[1], sys.argv[2], sys.argv[3]
thr = float(sys.argv[4]) if len(sys.argv) > 4 else 8.0
rx = re.compile(r'^2026-\d\d-\d\d (\d\d:\d\d:\d\d)\.\d+ \+07 \[\d+\] LOG:  duration: ([\d.]+) ms  execute \S+: ?(.*)$')
d = collections.defaultdict(list)
cur = None
with open(log, errors='replace') as f:
    for line in f:
        m = rx.match(line)
        if m:
            cur = None
            if t0 <= m.group(1) <= t1:
                cur = [float(m.group(2)), m.group(3)]
                d_key = None
                cur.append(None)
                pending = cur
            continue
        if cur is not None and not line.startswith('20'):
            cur[1] += ' ' + line.strip()
        elif cur is not None and line.startswith('20'):
            key = re.sub(r'\s+', ' ', cur[1])[:110]
            d[key].append(cur[0]); cur = None
    if cur is not None:
        key = re.sub(r'\s+', ' ', cur[1])[:110]; d[key].append(cur[0])
rows = [(max(v), statistics.median(v), len(v), k) for k, v in d.items() if max(v) >= thr]
rows.sort(reverse=True)
for mx, med, n, k in rows[:40]:
    print(f'max={mx:8.1f} p50={med:8.1f} n={n:4d}  {k}')
