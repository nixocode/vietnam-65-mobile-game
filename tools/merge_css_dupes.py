import io, re, sys

src = io.open('css/style.css', encoding='utf-8').read()

def parse(text, pos, end):
    """Return a list of nodes: ('comment',s) ('rule',sel,body,s) ('at',prelude,inner_nodes,s) ('raw',s)."""
    nodes, buf, i = [], '', pos
    while i < end:
        if text.startswith('/*', i):
            j = text.index('*/', i) + 2
            if buf.strip(): nodes.append(('raw', buf)); buf = ''
            elif buf: nodes.append(('raw', buf)); buf = ''
            nodes.append(('comment', text[i:j])); i = j; continue
        if text[i] == '{':
            # find the matching close brace
            depth, j = 1, i + 1
            while depth:
                if text.startswith('/*', j): j = text.index('*/', j) + 2; continue
                if text[j] == '{': depth += 1
                elif text[j] == '}': depth -= 1
                j += 1
            prelude = buf; buf = ''
            head = prelude.strip()
            if head.startswith('@') and re.match(r'@(media|supports|layer|container)\b', head):
                inner = parse(text, i + 1, j - 1)
                nodes.append(('at', prelude, head, inner))
            else:
                nodes.append(('rule', prelude, head, text[i + 1:j - 1]))
            i = j; continue
        buf += text[i]; i += 1
    if buf: nodes.append(('raw', buf))
    return nodes

def norm_sel(s):
    s = re.sub(r'\s+', ' ', s.strip())
    return ','.join(sorted(p.strip() for p in s.split(',')))

def decls(body):
    """Split a declaration body into a list of 'prop: value' strings, keeping comments attached."""
    out, buf, depth, i = [], '', 0, 0
    while i < len(body):
        c = body[i]
        if body.startswith('/*', i):
            j = body.index('*/', i) + 2; buf += body[i:j]; i = j; continue
        if c == '(': depth += 1
        elif c == ')': depth -= 1
        if c == ';' and depth == 0:
            if buf.strip(): out.append(buf.strip())
            buf = ''; i += 1; continue
        buf += c; i += 1
    if buf.strip(): out.append(buf.strip())
    return out

merged_count = [0]

def process(nodes):
    # group rules by normalised selector within THIS scope only
    groups = {}
    for idx, n in enumerate(nodes):
        if n[0] == 'rule':
            groups.setdefault(norm_sel(n[2]), []).append(idx)
    def prop_of(d):
        m = re.match(r'(?:/\*.*?\*/\s*)*([-\w]+)\s*:', d, re.S)
        return m.group(1) if m else None

    def parts(selstr):
        return set(re.sub(r'\s+', ' ', x.strip()) for x in selstr.split(','))

    drop = set()
    for sel, idxs in groups.items():
        if len(idxs) < 2: continue
        last = idxs[-1]
        merged_count[0] += len(idxs) - 1
        selparts = parts(nodes[last][2])
        combined = []
        for k in idxs:
            ds = decls(nodes[k][3])
            if k != last:
                # HOIST HAZARD. Moving an earlier declaration down to the last
                # rule's position moves it PAST everything in between. If a rule
                # in that gap also targets these elements and sets the same
                # property, that rule was winning and the hoist would silently
                # resurrect the dead one. Measured: border-radius 0 -> 3px on
                # five HUD elements, caught by the computed-style diff.
                blocked = set()
                for j in range(k + 1, last):
                    n2 = nodes[j]
                    if n2[0] != 'rule': continue
                    if not (parts(n2[2]) & selparts): continue
                    for d2 in decls(n2[3]):
                        pr = prop_of(d2)
                        if pr: blocked.add(pr)
                ds = [d for d in ds if prop_of(d) not in blocked]
            combined.extend(ds)
        # later declarations of the same property win, so keep the LAST of each
        seen, kept = set(), []
        for d in reversed(combined):
            m = re.match(r'(?:/\*.*?\*/\s*)*([-\w]+)\s*:', d, re.S)
            key = m.group(1) if m else d
            if key in seen and m: continue
            seen.add(key); kept.append(d)
        kept.reverse()
        body = '\n  ' + ';\n  '.join(kept) + ';\n'
        nodes[last] = ('rule', nodes[last][1], nodes[last][2], body)
        for k in idxs[:-1]: drop.add(k)
    out = []
    for idx, n in enumerate(nodes):
        if idx in drop:
            continue
        if n[0] == 'at':
            out.append(('at', n[1], n[2], process(list(n[3]))))
        else:
            out.append(n)
    return out

def emit(nodes):
    s = ''
    for n in nodes:
        if n[0] in ('comment', 'raw'): s += n[1]
        elif n[0] == 'rule': s += n[1] + '{' + n[3] + '}'
        elif n[0] == 'at': s += n[1] + '{' + emit(n[3]) + '}'
    return s

tree = parse(src, 0, len(src))
out = emit(process(tree))
io.open('css/style.merged.css', 'w', encoding='utf-8').write(out)
print('merged away %d duplicate rule blocks' % merged_count[0])
print('bytes %d -> %d' % (len(src), len(out)))
