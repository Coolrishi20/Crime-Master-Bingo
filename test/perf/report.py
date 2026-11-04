#!/usr/bin/env python3
"""Build the before/after performance tables (Markdown) from hosting-bench.js JSON results.
Usage: python3 test/perf/report.py baseline.json after-normal.json after-lowres.json > table.md
Only measured values are printed; anything missing is shown as 'not measured'."""
import json, sys

runs = [json.load(open(f)) for f in sys.argv[1:]]
names = [r.get('label', '?') + (' (Low Resource)' if r.get('mode') == 'lowres' else '') for r in runs]

def tag(r, t):
    for s in r['samples']:
        if s.get('tag') == t: return s
    return None
def ph(r, p): return r['phases'].get(p)
def fmt(v, unit=''):
    return 'not measured' if v is None else f'{v}{unit}'
def mem_tag(r, t):
    s = tag(r, t); return None if not s else s['totalMB']
def tree_tag(r, t):
    s = tag(r, t); return None if not s else s.get('treeMB')
def peak(r):
    return max((s['totalMB'] for s in r['samples']), default=None)
def tv(r, p, k):
    x = ph(r, p); return None if not x or 'tv' not in x else x['tv'].get(k)
def cpu(r, p):
    x = ph(r, p); return None if not x else x.get('cpuAvg')
def mem(r, p):
    x = ph(r, p); return None if not x else x.get('memAvgMB')
def ws(r, p):
    x = ph(r, p); return None if not x else x.get('wsKBPerMin')
def lag(r, p):
    x = ph(r, p); return None if not x else x['main'].get('lagMax')
def ipc(r, p, k):
    x = ph(r, p); return None if not x else x.get('ipcPerMin', {}).get(k, 0)
def ipckb(r, p, k):
    x = ph(r, p); return None if not x else x.get('ipcKBPerMin', {}).get(k, 0)
def fs(r, p):
    x = ph(r, p); return None if not x else round(x['main'].get('fsyncs', 0) / max(1, x['seconds']) * 60)
def drop(r, p):
    x = ph(r, p)
    if not x or 'tv' not in x: return None
    return f"{x['tv']['dropped']}/{x['tv']['decoded']} ({x['tv']['droppedPct']}%)"
def lat(r, p):
    x = ph(r, p)
    if not x: return None
    l = (x.get('extra') or {}).get('latency')
    return None if not l or not l.get('n') else f"median {l['median']} ms / max {l['max']} ms (n={l['n']})"
def growth(r):
    x = ph(r, 'T4_extended'); return None if not x else x.get('memGrowthMB')
def unexpected(r, p):
    x = ph(r, p); return None if not x else x.get('unexpectedReloads')

rows = [
    ('Startup RAM (all app processes)', lambda r: fmt(mem_tag(r, 'startup'), ' MB')),
    ('Idle RAM', lambda r: fmt(mem_tag(r, 'idle'), ' MB')),
    ('After importing 40 videos', lambda r: fmt(mem_tag(r, 'after import 40'), ' MB')),
    ('After importing 100 videos (library open)', lambda r: fmt(mem_tag(r, 'after import 100 (library open)'), ' MB')),
    ('Main-process freeze during import (max event-loop lag)', lambda r: fmt(max(x for x in [lag(r, 'import40'), lag(r, 'import100')] if x is not None) if lag(r, 'import40') is not None else None, ' ms')),
    ('PDF of 100 cards: time', lambda r: fmt((ph(r, 'pdf100') or {}).get('extra', {}).get('pdfSec'), ' s')),
    ('Playback RAM, TV only (T1a avg)', lambda r: fmt(mem(r, 'T1a_playback_no_phone'), ' MB')),
    ('Full system: TV video + overlay + crawler + phone connected (T1b avg)', lambda r: fmt(mem(r, 'T1b_full_system_phone_connected'), ' MB')),
    ('Active phone commands + TV video (T2 avg)', lambda r: fmt(mem(r, 'T2_active_phone_commands'), ' MB')),
    ('Peak RAM (whole run)', lambda r: fmt(peak(r), ' MB')),
    ('RAM after the extended session', lambda r: fmt(next((s['totalMB'] for s in reversed(r['samples']) if s.get('tag', '') and s['tag'].startswith('after ') and 'songs' in s['tag']), None), ' MB')),
    ('RAM growth over the extended session (last quarter − first quarter)', lambda r: fmt(growth(r), ' MB')),
    ('CPU, full system (T1b avg, % of one core, summed)', lambda r: fmt(cpu(r, 'T1b_full_system_phone_connected'), '%')),
    ('CPU, active phone commands (T2 avg)', lambda r: fmt(cpu(r, 'T2_active_phone_commands'), '%')),
    ('CPU, extended session (T4 avg)', lambda r: fmt(cpu(r, 'T4_extended'), '%')),
    ('Dropped video frames, TV only (T1a)', lambda r: fmt(drop(r, 'T1a_playback_no_phone'))),
    ('Dropped video frames, phone connected (T1b)', lambda r: fmt(drop(r, 'T1b_full_system_phone_connected'))),
    ('Dropped video frames, active phone commands (T2)', lambda r: fmt(drop(r, 'T2_active_phone_commands'))),
    ('Dropped video frames, extended session (T4)', lambda r: fmt(drop(r, 'T4_extended'))),
    ('TV renderer stalls > 50 ms per min (T2)', lambda r: fmt(tv(r, 'T2_active_phone_commands', 'janky50PerMin'))),
    ('Unexpected video reloads (T2 + T4)', lambda r: fmt(None if unexpected(r, 'T2_active_phone_commands') is None else (unexpected(r, 'T2_active_phone_commands') or 0) + (unexpected(r, 'T4_extended') or 0))),
    ('Phone command latency (T2)', lambda r: fmt(lat(r, 'T2_active_phone_commands'))),
    ('Data sent to the phone while idle (T1b)', lambda r: fmt(ws(r, 'T1b_full_system_phone_connected'), ' KB/min')),
    ('Data sent to the phone during commands (T2)', lambda r: fmt(ws(r, 'T2_active_phone_commands'), ' KB/min')),
    ('Full state updates sent to the TV during phone commands (T2)', lambda r: fmt(ipc(r, 'T2_active_phone_commands', 'tv:audience-state'), '/min')),
    ('Host-window state traffic during phone commands (T2)', lambda r: fmt(ipckb(r, 'T2_active_phone_commands', 'host:state'), ' KB/min')),
    ('Durable disk writes (fsync) while playing (T1b)', lambda r: fmt(fs(r, 'T1b_full_system_phone_connected'), '/min')),
]
print('| Metric | ' + ' | '.join(names) + ' |')
print('|---|' + '---|' * len(runs))
for label, f in rows:
    print(f'| {label} | ' + ' | '.join(f(r) for r in runs) + ' |')
print()
for r, n in zip(runs, names):
    c = r.get('checks', [])
    print(f"**{n}** — integrated checks: {sum(1 for x in c if x['ok'])}/{len(c)} passed" + ('' if all(x['ok'] for x in c) else ' — FAILED: ' + '; '.join(x['name'] + ' (' + x['detail'] + ')' for x in c if not x['ok'])) + f"; duration {r.get('durationMin')} min; songs played {r.get('final', {}).get('played')}" + (f"; ERROR: {r['error'][:200]}" if r.get('error') else ''))
