import json,glob,html
d=json.load(open(glob.glob('sheet-Full*')[0]))['values'][1:]
H=json.load(open('fn-game-honours.json'))['rows']
S28={'saviano':('Borussia Dortmund',1,6),'mcgregor':('Juventus',1,20),'harmer':('Atlético Madrid',2,18)}
PEOPLE=[('dario','saviano','Dario Saviano','Dario Saviano'),('kevin','mcgregor','Kevin McGregor','kevin mcgregor'),
        ('gav','harmer','Gav Harmer','Gav Harmer'),('luis','libras','Luís André Libras-Boas','Luís André Libras-Boas')]
LEAGUE=lambda c:c.startswith('Division')
def career(key):
    rows=[(int(r[0]),int(r[1]),int(r[2]),r[4]) for r in d if len(r)>16 and key in r[16].lower()]
    if key in S28: c,dv,p=S28[key]; rows.append((28,dv,p,c))
    by={}
    for s,dv,p,c in rows: by.setdefault(s,[]).append((dv,p,c))
    out=[]
    for s in sorted(by):
        opts=by[s]
        if len(opts)>1:
            nxt=[c for _,_,c in by.get(s+1,[])]
            opts=[o for o in opts if o[2] in nxt] or opts
        dv,p,c=opts[0]; out.append(dict(s=s,div=dv,pos=p,club=c,rank=(dv-1)*20+p))
    return out
SHORT={'AS Monaco':'Monaco','Boca Juniors':'Boca','Newcastle United':'Newcastle','West Bromwich Albion':'West Brom','Leicester City':'Leicester','Beşiktaş JK':'Beşiktaş','Borussia Dortmund':'Borussia Dortmund','Levante UD':'Levante','Werder Bremen':'Werder','Chievo Verona':'Chievo Verona'}
COL=['#60a5fa','#f472b6','#34d399','#fbbf24','#a78bfa','#fb923c','#22d3ee']
def svg(person):
    tag,key,name,hname=person
    C=career(key)
    hon=[h for h in H if h['manager_name']==hname]
    po={h['season_num'] for h in hon if 'Play-off' in h['competition']}
    cups={}
    for h in hon:
        if not LEAGUE(h['competition']): cups.setdefault(h['season_num'],[]).append(h['competition'])
    W,Ht=1088,420; L,R,T,B=56,20,74,46
    s0,s1=1,28
    X=lambda s:L+(s-s0)/(s1-s0)*(W-L-R)
    Y=lambda r:T+(r-1)/99*(Ht-T-B)
    o=[f'<svg width="{W}" height="{Ht}" viewBox="0 0 {W} {Ht}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Roboto,Helvetica,Arial,sans-serif">']
    # club bands
    segs=[];
    for p in C:
        if segs and segs[-1]['club']==p['club'] and p['s']==segs[-1]['e']+1: segs[-1]['e']=p['s']
        else: segs.append(dict(club=p['club'],b=p['s'],e=p['s']))
    clubs=[]; 
    for sg in segs:
        if sg['club'] not in clubs: clubs.append(sg['club'])
    for sg in segs:
        col=COL[clubs.index(sg['club'])%len(COL)]
        x0=X(sg['b'])-(W-L-R)/27/2; x1=X(sg['e'])+(W-L-R)/27/2
        o.append(f'<rect x="{x0:.1f}" y="{T-66}" width="{x1-x0:.1f}" height="{Ht-B-T+66}" fill="{col}" opacity="0.08"/>')
        nm=SHORT.get(sg['club'],sg['club']); lab=nm if (x1-x0)>len(nm)*7.4 else ''
        _=sg['club'] if (x1-x0)>len(sg['club'])*7.2 else (sg['club'].split()[0] if (x1-x0)>len(sg['club'].split()[0])*7.2 else '')
        o.append(f'<text x="{(x0+x1)/2:.1f}" y="{Ht-B-10}" fill="{col}" font-size="13" font-weight="700" text-anchor="middle">{html.escape(lab)}</text>')
    # grid
    for r,lab in [(1,'#1'),(21,'#21 · D2'),(41,'#41 · D3'),(61,'#61 · D4'),(81,'#81 · D5'),(100,'#100')]:
        o.append(f'<line x1="{L}" x2="{W-R}" y1="{Y(r):.1f}" y2="{Y(r):.1f}" stroke="#94a3b8" stroke-opacity=".18" stroke-dasharray="4 4"/>')
        o.append(f'<text x="{L-8}" y="{Y(r)+4:.1f}" fill="#9fb0c8" font-size="13" text-anchor="end">{lab.split(" ·")[0]}</text>')
    for s in range(1,29):
        if s%3==1 or s==28: o.append(f'<text x="{X(s):.1f}" y="{Ht-B+22}" fill="#9fb0c8" font-size="13" text-anchor="middle">S{s}</text>')
    # line per continuous run
    runs=[[C[0]]]
    for p in C[1:]:
        (runs[-1].append(p) if p['s']==runs[-1][-1]['s']+1 else runs.append([p]))
    for run in runs:
        pts=' '.join(f'{X(p["s"]):.1f},{Y(p["rank"]):.1f}' for p in run)
        o.append(f'<polyline points="{pts}" fill="none" stroke="#60a5fa" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>')
    for i,p in enumerate(C):
        x,y=X(p['s']),Y(p['rank'])
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#fff" stroke="#60a5fa" stroke-width="2"/>')
        badge=None
        if p['pos']==1: badge=('👑',None)
        elif p['s'] in po: badge=('▲','#d97706')
        elif p['pos']<=3 and p['div']>1: badge=('▲','#16a34a')
        elif p['pos']>=17 and p['div']<5: badge=('▼','#dc2626')
        if badge:
            g,col=badge; by_=y+22 if g=='▼' else y-22
            if col: o.append(f'<rect x="{x-10:.1f}" y="{by_-10:.1f}" width="20" height="20" rx="4" fill="{col}"/><text x="{x:.1f}" y="{by_+5:.1f}" fill="#fff" font-size="13" font-weight="800" text-anchor="middle">{g}</text>')
            else: o.append(f'<text x="{x:.1f}" y="{by_+7:.1f}" font-size="20" text-anchor="middle">{g}</text>')
        if p['s'] in cups:
            n=len(cups[p['s']]); cy=y-(46 if (badge and badge[0]!='▼') else 24)
            o.append(f'<circle cx="{x:.1f}" cy="{cy:.1f}" r="11" fill="#f59e0b" stroke="#fde68a" stroke-width="1.5"/><text x="{x:.1f}" y="{cy+5:.1f}" font-size="12" text-anchor="middle">🏆</text>')
            if n>1: o.append(f'<text x="{x+14:.1f}" y="{cy-6:.1f}" fill="#fbbf24" font-size="13" font-weight="800">{n}</text>')
    o.append('</svg>')
    first,last=C[0]['s'],C[-1]['s']
    best=min(p['rank'] for p in C)
    return ''.join(o),C,first,last,best,sum(len(v) for v in cups.values()),clubs
cards=[]
for person in PEOPLE:
    s,C,first,last,best,ncup,clubs=svg(person)
    seasons=len(C)
    cards.append(f'''<div class="card" id="{person[0]}"><div class="top"><span>Top 100 · Career · Seasons {first} to {last}</span><span class="badge">📈 Career</span></div>
<h1>{html.escape(person[2])}</h1>
<div class="legend"><span>👑 Champions</span><span><i style="background:#16a34a">▲</i> Promoted</span><span><i style="background:#d97706">▲</i> Play-off winners</span><span><i style="background:#dc2626">▼</i> Relegated</span><span><i class="cup">🏆</i> Cup win</span><span class="dim">Overall rank, #1 to #100</span></div>
<div class="chart">{s}</div>
<div class="foot"><span>{seasons} seasons · best rank #{best} · {ncup} cup{"" if ncup==1 else "s"}</span><span>archive.smtop100.blog</span></div></div>''')
    print(person[0],seasons,first,last,best,ncup,clubs)
css='''*{box-sizing:border-box;margin:0;padding:0}body{background:#0b1220;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#e8eef8;padding:20px}
.card{width:1200px;height:675px;margin:0 0 30px;border-radius:28px;padding:40px 56px;position:relative;overflow:hidden;background:radial-gradient(circle at 85% 12%,rgba(148,163,184,.2) 0,transparent 45%),linear-gradient(135deg,#1b2333 0%,#0a1630 100%);border:2px solid #94a3b8}
.top{display:flex;justify-content:space-between;align-items:center;font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#cbd5e1}
.badge{background:#e2e8f0;color:#111827;font-weight:800;padding:8px 18px;border-radius:999px;letter-spacing:.06em}
h1{font-size:46px;font-weight:800;margin-top:10px;line-height:1.1}
.legend{display:flex;flex-wrap:wrap;gap:18px;margin-top:10px;font-size:16px;color:#c9d6ea;align-items:center}
.legend i{display:inline-flex;width:20px;height:20px;border-radius:4px;color:#fff;font-style:normal;font-size:12px;font-weight:800;align-items:center;justify-content:center;margin-right:4px}
.legend i.cup{background:#f59e0b;border-radius:50%}.legend .dim{color:#8a94a6}
.chart{margin-top:4px}
.foot{position:absolute;bottom:22px;left:56px;right:56px;display:flex;justify-content:space-between;font-size:17px;color:#8a94a6;letter-spacing:.06em}'''
open('/home/user/top100-tournaments/docs/appointment-cards/s28-career-charts.html','w').write(f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(cards)}</body></html>')
