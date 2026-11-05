"""Anthem Square 'a' mark — vector rebuild of the supplied logo in the approved palette.
Geometry in the source image's 1286x1223 space, scaled into a viewBox."""
import os
NAVY, CREAM, ORANGE, GRAY = '#102542', '#FFF2CF', '#FF5B32', '#171717'
OUT = os.path.dirname(os.path.abspath(__file__))

# grid geometry (source space)
COLS = [(110, 228), (243, 362), (377, 493), (508, 627), (641, 758), (773, 890), (905, 1020)]   # c-1..c5
ROWS = [(150, 350), (365, 492), (508, 637), (652, 782), (798, 942), (958, 1100)]              # r0..r5
O, C = 'O', 'C'
PATTERN = [  # rows x 7 columns (c-1 .. c5)
    [O, O, O, O, O, O, O],
    [C, O, C, C, C, C, C],
    [C, O, O, O, O, O, C],
    [C, C, C, C, C, O, C],
    [O, O, O, O, O, O, O],
    [C, C, C, C, C, C, C],
]
CX, CY, R_LINE, R_CELLS = 563, 605, 428, 412
STEM = ('M 926 66 H 1128 Q 1140 66 1140 78 V 822 Q 1142 870 1192 882 H 1226 Q 1238 882 1238 894 '
        'V 1102 Q 1238 1114 1226 1114 H 1030 Q 940 1112 922 1010 Z')
NOTE = ('<g transform="translate(548 578)"><ellipse cx="0" cy="0" rx="25" ry="22" transform="rotate(-20)"/>'
        '<rect x="18" y="-62" width="9" height="62" rx="3"/>'
        '<path d="M18 -64 C 40 -58 52 -50 54 -36 C 55 -28 52 -20 48 -16 C 48 -34 36 -42 27 -44 Z"/></g>')

def mark(ring, line, orange, cream, note, uid):
    cells = []
    for ri, (y0, y1) in enumerate(ROWS):
        for ci, (x0, x1) in enumerate(COLS):
            col = orange if PATTERN[ri][ci] == O else cream
            if col is None: continue
            cells.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="{col}"/>')
    note_svg = f'<g fill="{note}">{NOTE}</g>' if note else ''
    return (f'<defs><clipPath id="{uid}"><circle cx="{CX}" cy="{CY}" r="{R_CELLS}"/></clipPath></defs>'
            f'<ellipse cx="500" cy="602" rx="482" ry="547" fill="{ring}"/><path d="{STEM}" fill="{ring}"/>'
            f'<circle cx="{CX}" cy="{CY}" r="{R_LINE}" fill="{line}"/>'
            f'<g clip-path="url(#{uid})">{"".join(cells)}</g>{note_svg}')

def svg(variant, bg=None, tile=False, pad=0.0):
    """variant: dark | light | mono-blue | mono-cream | dark-on-tile"""
    V = {
        'dark':       dict(ring=CREAM, line=NAVY,  orange=ORANGE, cream=CREAM, note=NAVY),
        'light':      dict(ring=NAVY,  line=NAVY,  orange=ORANGE, cream=CREAM, note=NAVY),
        'mono-blue':  dict(ring=NAVY,  line='#FFFFFF', orange=NAVY, cream=None, note='#FFFFFF'),
        'mono-cream': dict(ring=CREAM, line=NAVY,  orange=CREAM, cream=None, note=NAVY),
    }[variant]
    # content box of the mark: x 20..1240, y 55..1150 → 1220 x 1095
    w, h = 1240, 1240
    side = max(w, h) * (1 + 2 * pad)
    ox = (side - 1220) / 2 - 20; oy = (side - 1095) / 2 - 55
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side:.0f} {side:.0f}">']
    if tile: out.append(f'<rect width="{side:.0f}" height="{side:.0f}" rx="{side*0.22:.0f}" fill="{bg}"/>')
    elif bg: out.append(f'<rect width="{side:.0f}" height="{side:.0f}" fill="{bg}"/>')
    out.append(f'<g transform="translate({ox:.1f} {oy:.1f})">{mark(uid="g" + variant.replace("-", ""), **V)}</g></svg>')
    return ''.join(out)

FILES = {
    'mark-dark.svg': svg('dark'),                         # cream "a" for dark backgrounds (transparent)
    'mark-light.svg': svg('light'),                       # navy "a" for light backgrounds (transparent)
    'mark-mono-blue.svg': svg('mono-blue'),
    'mark-mono-cream.svg': svg('mono-cream'),
    'app-icon.svg': svg('dark', bg=NAVY, tile=True, pad=0.14),   # taskbar / installer / phone home screen
    'app-icon-square.svg': svg('dark', bg=NAVY, pad=0.10),
}
if __name__ == '__main__':
    for n, t in FILES.items():
        open(os.path.join(OUT, n), 'w').write(t)
    print('written', list(FILES))
