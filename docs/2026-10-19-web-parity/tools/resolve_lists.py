# -*- coding: utf-8 -*-
"""Giải xung đột ở spec danh sách theo khối lane (CORE, SHOP, ORDER...).

Hunk có khai báo `const <KHỐI>` ở cả hai bên: mỗi khối lấy bên không rỗng, hai bên đều có nội dung thì báo lỗi.
Hunk khác (thường là import): lấy bên HEAD rồi thêm dòng bên kia chưa có.
Dùng: python3 -I resolve_lists.py <file>...
"""
import re
import sys

HUNK = re.compile(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", re.S)
DECL = re.compile(r"^const ([A-Z_]+)(:[^=]*)?=", re.M)
KEY = re.compile(r"^(\s+[A-Za-z_$][\w$]*)\s*:")


def blocks(text):
    starts = [(m.start(), m.group(1)) for m in DECL.finditer(text)]
    out = {}
    order = []
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        out[name] = text[pos:end]
        order.append(name)
    head = text[: starts[0][0]] if starts else text
    return head, order, out


def empty(block):
    return re.search(r"=\s*\[\s*\];", block) is not None


def resolve(ours, theirs):
    if DECL.search(ours) and DECL.search(theirs):
        h1, o1, b1 = blocks(ours)
        h2, o2, b2 = blocks(theirs)
        if h1.strip() or h2.strip():
            raise SystemExit("hunk có phần trước khai báo, giải tay")
        names = o1 + [n for n in o2 if n not in o1]
        res = []
        for n in names:
            a, b = b1.get(n), b2.get(n)
            if a is None or (b is not None and empty(a)):
                res.append(b)
            elif b is None or empty(b) or a == b:
                res.append(a)
            else:
                raise SystemExit(f"khối {n} có nội dung ở cả hai bên, giải tay")
        return "".join(res)
    lines = ours.splitlines(keepends=True)
    for l in theirs.splitlines(keepends=True):
        if l not in lines:
            lines.append(l)
    # Hai bên cùng sửa một khoá trong object (ví dụ mock useParams) thì gộp dòng sẽ ra khoá trùng, tsc mới báo (TS1117).
    keys = [m.group(1) for m in (KEY.match(l) for l in lines) if m]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise SystemExit(f"khoá trùng {dup} sau khi gộp dòng, giải tay")
    return "".join(lines)


for path in sys.argv[1:]:
    s = open(path, encoding="utf-8").read()
    s2 = HUNK.sub(lambda m: resolve(m.group(1), m.group(2)), s)
    if "<<<<<<<" in s2 or ">>>>>>>" in s2:
        raise SystemExit(f"{path}: còn dấu xung đột")
    open(path, "w", encoding="utf-8").write(s2)
    print("ok", path)
