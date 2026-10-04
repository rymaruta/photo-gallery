import json, time, urllib.request, urllib.parse, sys
sys.path.insert(0,'.')
import research as R
hits=json.load(open('openphoto_hits.json'))
bad={('amanohashidate','tsucity'),('nakanoshima-library','kitacitytokyo'),('takebe','kitacitytokyo'),('uozu-shinkirou','tsucity')}
hits=[h for h in hits if (h[0],h[2]) not in bad]
targets={t['slug']:t for t in json.load(open('targets.json'))}
UA="JourneyPhotoSpotResearch/1.0 (https://journey-photo.com)"
cache={}
def client_photos(c):
    if c in cache: return cache[c]
    out=[]; page=1
    while True:
        u=f"https://api.openphoto.app/api/photos?client={c}&page={page}"
        req=urllib.request.Request(u,headers={"User-Agent":UA})
        d=json.loads(urllib.request.urlopen(req,timeout=40).read())
        out+=d.get('data',[])
        time.sleep(5)
        if not d.get('next_page_url') or page>=60: break
        page+=1
    cache[c]=out; return out
res={}
for slug,name,c,cname in hits:
    t=targets[slug]; toks=R.tokens(t)
    ph=client_photos(c)
    m=[]
    for x in ph:
        text=' '.join(str(x.get(k) or '') for k in ('title','description'))+' '+' '.join((tg.get('label') or '') for tg in (x.get('tags') or []) if isinstance(tg,dict))
        if R.named(text,toks):
            lic=(x.get('license') or {}).get('name')
            m.append({'id':x.get('id'),'title':x.get('title'),'license':lic,'open':(x.get('license') or {}).get('is_open_license'),
                      'url':f"https://openphoto.app/c/{c}/{x.get('id')}",'creator':(x.get('creator') or {}).get('name') if isinstance(x.get('creator'),dict) else x.get('creator')})
    res.setdefault(slug,{'name':name,'clients':[],'matches':[]})
    res[slug]['clients'].append({'client':c,'total':len(ph)}); res[slug]['matches']+=m
    print(slug,name,c,len(ph),'matched',len(m),flush=True)
json.dump(res,open('openphoto_results.json','w'),ensure_ascii=False,indent=1)
