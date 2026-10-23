#!/usr/bin/env python3
"""Tìm câu SQL bị 'lật kế hoạch' (generic plan sau 5 lần thực thi của câu đã prepare): so trung vị thời gian execute của 5 lần đầu
với các lần sau trong cùng một khoảng giờ của log Postgres 25434. Dùng: planflip.py <log> <HH:MM:SS bắt đầu> <HH:MM:SS kết thúc>.
Chỉ in câu có >= 12 lần chạy và trung vị sau >= 3 ms và >= 2,5 lần trung vị 5 lần đầu."""
import re, sys, collections, statistics
log, t0, t1 = sys.argv[1:4]
rx = re.compile(r'^2026-\d\d-\d\d (\d\d:\d\d:\d\d)\.\d+ \+07 \[(\d+)\] LOG:  duration: ([\d.]+) ms  execute \S+: ?(.*)$')
seq = collections.defaultdict(list)
cur = None
def flush():
    global cur
    if cur:
        key = re.sub(r'\s+', ' ', cur[1])[:120]
        seq[key].append(cur[0]); cur = None
with open(log, errors='replace') as f:
    for line in f:
        m = rx.match(line)
        if m:
            flush()
            if t0 <= m.group(1) <= t1: cur = [float(m.group(3)), m.group(4)]
            continue
        if cur is not None:
            if line.startswith('20'): flush()
            else: cur[1] += ' ' + line.strip()
flush()
for k, v in sorted(seq.items(), key=lambda kv: -max(kv[1])):
    if len(v) < 12: continue
    a, b = statistics.median(v[:5]), statistics.median(v[5:])
    if b >= 3 and b >= 2.5 * a: print(f'n={len(v):4d} first5_p50={a:8.2f} later_p50={b:8.2f} x{b/max(a,0.01):5.1f}  {k}')
