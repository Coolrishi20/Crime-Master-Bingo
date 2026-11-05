"""Build the complete Anthem Square brand set from the new 'a' mark.
Usage: python3 build_brand.py <repo> [option]   option: tile (default) | square
Writes SVGs; PNG/ICO rendering is done by render_pngs.js afterwards."""
import os, sys, base64, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import genlogo as G
NAVY, CREAM, ORANGE = G.NAVY, G.CREAM, G.ORANGE
REPO = sys.argv[1]
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'anthem', 'fonts')

frame = G.frame
DARK, LIGHT = G.DARK, G.LIGHT_V
shape = sys.argv[2] if len(sys.argv) > 2 else 'tile'
icon = frame(G.mark(**DARK), NAVY, shape)                      # app icon (tile or square)
icon_small = frame(G.small_mark(CREAM, NAVY, ORANGE, CREAM, 'as'), NAVY, shape, pad=0.08)
icon_square = frame(G.mark(**DARK), NAVY, 'square', pad=0.10)
mark_dark = frame(G.mark(**DARK), None, pad=0.0)               # cream "a", transparent gaps
mark_light = frame(G.mark(**LIGHT), None, pad=0.0)             # navy "a" for light backgrounds
print_icon = frame(G.mark(**G.PRINT), None, pad=0.0)
mono_blue = frame(G.mark(**G.MONO_BLUE), None, pad=0.0)
mono_cream = frame(G.mark(**G.MONO_CREAM), None, pad=0.0)

def font_css():
    d = lambda w: base64.b64encode(open(os.path.join(FONTS, f'montserrat-latin-{w}-normal.woff2'), 'rb').read()).decode()
    return f'<style>@font-face{{font-family:Montserrat;font-weight:800;src:url(data:font/woff2;base64,{d(800)})}}@font-face{{font-family:Montserrat;font-weight:700;src:url(data:font/woff2;base64,{d(700)})}}</style>'
def inner(svg): return re.sub(r'^<svg[^>]*>|</svg>$', '', svg)
def vb(svg): return float(re.search(r'viewBox="0 0 ([\d.]+)', svg).group(1))

def horizontal(theme, desc=True):
    fg, sub = (CREAM, '#B3B4AA') if theme == 'dark' else (NAVY, '#4E5B6B')
    m = mark_dark if theme == 'dark' else mark_light; k = 180 / vb(m)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 200">{font_css()}<g transform="translate(6 10) scale({k:.4f})">{inner(m)}</g>'
            f'<rect x="212" y="34" width="6" height="132" rx="3" fill="{ORANGE}"/>'
            f'<text x="240" y="{92 if desc else 98}" font-family="Montserrat" font-weight="800" font-size="66" fill="{fg}" letter-spacing="-1">ANTHEM</text>'
            f'<text x="240" y="{152 if desc else 164}" font-family="Montserrat" font-weight="800" font-size="66" fill="{ORANGE}" letter-spacing="-1">SQUARE</text>'
            + (f'<text x="243" y="186" font-family="Montserrat" font-weight="700" font-size="17" fill="{sub}" letter-spacing="7">MUSIC VIDEO BINGO</text>' if desc else '') + '</svg>')
def stacked(theme, tagline=False):
    fg, sub = (CREAM, '#B3B4AA') if theme == 'dark' else (NAVY, '#4E5B6B')
    m = mark_dark if theme == 'dark' else mark_light; k = 190 / vb(m)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 {470 if tagline else 430}">{font_css()}<g transform="translate(115 6) scale({k:.4f})">{inner(m)}</g>'
            f'<text x="210" y="262" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="62" fill="{fg}" letter-spacing="-1">ANTHEM</text>'
            f'<text x="210" y="326" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="62" fill="{ORANGE}" letter-spacing="-1">SQUARE</text>'
            f'<rect x="160" y="348" width="100" height="4" rx="2" fill="{ORANGE}"/>'
            f'<text x="214" y="388" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="16" fill="{sub}" letter-spacing="6.5">MUSIC VIDEO BINGO</text>'
            + (f'<text x="212" y="440" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="17" fill="{fg}" letter-spacing="3">HEAR IT. MARK IT. <tspan fill="{ORANGE}">OWN IT.</tspan></text>' if tagline else '') + '</svg>')

W = lambda rel, t: (os.makedirs(os.path.dirname(os.path.join(REPO, rel)), exist_ok=True), open(os.path.join(REPO, rel), 'w').write(t))
W('src/renderer/shared/brand/icon.svg', icon)
W('src/renderer/shared/brand/icon-small.svg', icon_small)
W('src/renderer/shared/brand/print-icon.svg', print_icon)
W('src/renderer/shared/brand/mark-dark.svg', mark_dark)
W('src/renderer/shared/brand/mark-light.svg', mark_light)
B = 'assets/brand/anthem-square-'
for n, t in {'icon.svg': icon, 'icon-small.svg': icon_small, 'icon-square.svg': icon_square, 'icon-print.svg': print_icon, 'mono-blue.svg': mono_blue, 'mono-cream.svg': mono_cream,
             'mark-dark.svg': mark_dark, 'mark-light.svg': mark_light,
             'horizontal-dark.svg': horizontal('dark'), 'horizontal-light.svg': horizontal('light'),
             'stacked-dark.svg': stacked('dark'), 'stacked-light.svg': stacked('light'),
             'stacked-tagline-dark.svg': stacked('dark', True), 'stacked-tagline-light.svg': stacked('light', True)}.items():
    W(B + n, t)
# printed cards embed the print icon inline
p = os.path.join(REPO, 'src/renderer/print/print.js'); s = open(p).read()
s2 = re.sub(r"var PRINT_ICON = '<svg.*?</svg>';", lambda m: "var PRINT_ICON = '" + print_icon.replace("'", "\\'") + "';", s, count=1, flags=re.S)
assert s2 != s or print_icon in s; open(p, 'w').write(s2)
print('brand SVGs written (' + shape + ')')
