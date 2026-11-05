"""Anthem Square 'a' mark — traced from the supplied logo (tools/brand/traced.json) and recoloured
in the approved palette. Shapes are the original's; only the colours change."""
import os, json
NAVY, CREAM, ORANGE, GRAY = '#102542', '#FFF2CF', '#FF5B32', '#171717'
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(os.path.join(HERE, 'traced.json')))
FULL = (0, 0, T['w'], T['h'])
def _real(c): return not (c['bbox'][0] <= 1 and c['bbox'][1] <= 1 and c['bbox'][2] >= T['w'] - 1)
LIGHT = sorted([c for c in T['light'] if _real(c)], key=lambda c: -c['area'])
ORANGE_C = [c for c in T['orange'] if _real(c)]
RING_OUTER = LIGHT[0]['d']           # silhouette of the "a"
BOWL = LIGHT[1]                       # the round opening that holds the grid
CELLS = ''.join(c['d'] for c in LIGHT[2:])          # cream squares (with the note as a hole)
ORANGE_D = ''.join(c['d'] for c in ORANGE_C)        # orange squares (with the note as a hole)
LIGHT_D = ''.join(c['d'] for c in LIGHT)            # cream "a" + cream squares, navy left open
BX0, BY0, BX1, BY1 = T['bbox']
CX = (BOWL['bbox'][0] + BOWL['bbox'][2]) / 2; CY = (BOWL['bbox'][1] + BOWL['bbox'][3]) / 2

def mark(ring, line, orange, cream, note=None, uid='m'):
    """ring: the 'a'; line: grid lines + circle; orange/cream: squares. note follows the gaps (line)."""
    if ring == cream and line is None:     # transparent gaps (cream "a" on a dark background)
        return f'<path fill="{ring}" fill-rule="evenodd" d="{LIGHT_D}"/><path fill="{orange}" fill-rule="evenodd" d="{ORANGE_D}"/>'
    out = [f'<path fill="{ring}" d="{RING_OUTER}"/>']
    if line and line != ring: out.append(f'<path fill="{line}" d="{BOWL["d"]}"/>')
    if cream: out.append(f'<path fill="{cream}" fill-rule="evenodd" d="{CELLS}"/>')
    out.append(f'<path fill="{orange}" fill-rule="evenodd" d="{ORANGE_D}"/>')
    return ''.join(out)

def small_mark(ring, line, orange, cream, uid='s'):
    """16–32 px: the traced 'a' and circle, with the grid simplified to bold bands (no thin lines, no note)."""
    rows = [(150, 352), (370, 488), (506, 638), (656, 778), (796, 1100)]
    pat = [['O'], [('O', 100, 362), ('C', 380, 1030)], ['O'], [('C', 100, 755), ('O', 773, 1030)], ['O']]
    cells = []
    for (y0, y1), p in zip(rows, pat):
        if p == ['O']: cells.append(f'<rect x="100" y="{y0}" width="930" height="{y1-y0}" fill="{orange}"/>')
        else:
            for col, x0, x1 in p: cells.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="{orange if col == "O" else cream}"/>')
    k = 0.955
    return (f'<defs><clipPath id="{uid}"><path transform="translate({CX*(1-k):.1f} {CY*(1-k):.1f}) scale({k})" d="{BOWL["d"]}"/></clipPath></defs>'
            f'<path fill="{ring}" d="{RING_OUTER}"/><path fill="{line}" d="{BOWL["d"]}"/><g clip-path="url(#{uid})">{"".join(cells)}</g>')

def frame(inner, bg=None, shape='tile', pad=0.14):
    w, h = BX1 - BX0, BY1 - BY0
    side = max(w, h) * (1 + 2 * pad); ox = (side - w) / 2 - BX0; oy = (side - h) / 2 - BY0
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side:.0f} {side:.0f}">']
    if bg: out.append(f'<rect width="{side:.0f}" height="{side:.0f}"{f" rx=\"{side*0.22:.0f}\"" if shape == "tile" else ""} fill="{bg}"/>')
    out.append(f'<g transform="translate({ox:.1f} {oy:.1f})">{inner}</g></svg>')
    return ''.join(out)

DARK = dict(ring=CREAM, line=None, orange=ORANGE, cream=CREAM)          # cream "a", gaps show the background
LIGHT_V = dict(ring=NAVY, line=NAVY, orange=ORANGE, cream=CREAM)        # navy "a" for cream/light backgrounds
PRINT = dict(ring=NAVY, line=NAVY, orange=ORANGE, cream='#FFFFFF')      # on white paper
MONO_BLUE = dict(ring=NAVY, line=NAVY, orange=NAVY, cream='#FFFFFF')
MONO_CREAM = dict(ring=CREAM, line=NAVY, orange=CREAM, cream=NAVY)

if __name__ == '__main__':
    for n, t in {'mark-dark.svg': frame(mark(**DARK), pad=0), 'mark-light.svg': frame(mark(**LIGHT_V), pad=0),
                 'app-icon.svg': frame(mark(**DARK), NAVY), 'app-icon-small.svg': frame(small_mark(CREAM, NAVY, ORANGE, CREAM), NAVY, pad=0.08)}.items():
        open(os.path.join(HERE, n), 'w').write(t)
    print('ok')
