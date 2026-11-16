# Compare chaque cellule des extractions passees (Extraction_ulterieure_mis_a_jour) a data/history.csv.
# Usage : python scripts/verifier_historique.py (depuis la racine du depot)
import pandas as pd, glob, re, unicodedata, sys, warnings
warnings.filterwarnings("ignore")
def N(s): return re.sub(r"[^a-z0-9]","",unicodedata.normalize("NFKD",str(s)).encode("ascii","ignore").decode().lower())
MOIS={"janvier":1,"fevrier":2,"mars":3,"avril":4,"mai":5,"juin":6,"juillet":7,"aout":8,"septembre":9,"octobre":10,"novembre":11,"decembre":12}
def code(p):
    if isinstance(p,(pd.Timestamp,)) or hasattr(p,"strftime"): return p.strftime("%Y%m")
    t=N(p); m=re.match(r"([a-z]+)(\d{4})",t)
    if m and m.group(1) in MOIS: return f"{m.group(2)}{MOIS[m.group(1)]:02d}"
    try: return pd.to_datetime(str(p)).strftime("%Y%m")
    except Exception: return None
h=pd.read_csv("data/history.csv",dtype=str,keep_default_na=False); h["v"]=pd.to_numeric(h.valeur,errors="coerce")
h["d"]=h.district.map(N); h["f"]=h.formulaire.map(N); h["p"]=h.periode_code
fichiers={"2026-09-21":"21_09","2026-09-28":"28_09","2026-10-05":"05_10","2026-10-12":"12_10","2026-11-02":"02_11"}
tot_ok=True
for wk,tag in fichiers.items():
    f=[x for x in glob.glob("Extraction_ulterieure_mis_à_jour/*") if tag in x][0]
    x=pd.ExcelFile(f); recs=[]; inconnus=0
    for sh in x.sheet_names:
        raw=x.parse(sh,header=None)
        hdr=[i for i in range(8) if raw.iloc[i,2:].astype(str).str.contains("Reporting rate",case=False).any()][0]
        cols=[N(re.sub(r"\s*-\s*Reporting rate\s*$","",str(c),flags=re.I)) for c in raw.iloc[hdr,2:]]
        df=raw.iloc[hdr+1:].copy(); df.iloc[:,0]=df.iloc[:,0].ffill()
        df=df[df.iloc[:,0].notna() & ~df.iloc[:,0].astype(str).str.upper().str.startswith("DRS")]
        per=df.iloc[:,1].map(code)
        inconnus+=int(per.isna().sum())
        for j,c in enumerate(cols):
            v=pd.to_numeric(df.iloc[:,j+2],errors="coerce")
            recs+=list(zip(df.iloc[:,0].map(N),per,[c]*len(df),v))
    F=pd.DataFrame(recs,columns=["d","p","f","vf"]).dropna(subset=["p"])
    g=h[h.semaine_cle==wk]
    m=g.merge(F,on=["d","p","f"],how="outer",indicator=True)
    b=m[m._merge=="both"]
    egal=((b.v.isna()&b.vf.isna())|((b.v-b.vf).abs()<=0.011)).sum()
    print(f"{wk}: fichier={len(F)} cellules, histo={len(g)} | communes={len(b)} égales={egal} DIFFÉRENTES={len(b)-egal} | seulement fichier={int((m._merge=='right_only').sum())} seulement histo={int((m._merge=='left_only').sum())} | périodes illisibles={inconnus}")
    if (m._merge!="both").any() or len(b)!=egal: tot_ok=False; print(m[m._merge!="both"].head(4)[["d","p","f","v","vf","_merge"]].to_string())
print("TOUT IDENTIQUE" if tot_ok else "ÉCARTS")
