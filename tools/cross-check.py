"""Porównanie TEK-PŁYTA z niezależnym programem MES xdfem2d (P. Cachim, PyPI) — test T8 (spec. sekcja 7).

Ta sama siatka, podpory i obciążenia; xdfem2d liczy własnym kodem elementami DKT i MITC3.
Kryteria (spec.): momenty ±5 % (odniesione do maksimum |M| przypadku), ugięcia ±10 %.
Użycie:
    node tools/export-case.mjs cross-check.json
    python3 tools/cross-check.py cross-check.json [docs/weryfikacja-xdfem2d.md]
"""
import json, sys
import numpy as np
from xdfem2d import Structure2D


def solve_xdfem(case, formulation):
    s = Structure2D(domain='plate')
    s.add_material('C', elastic_modulus=case['E'], unit_weight=0.0, poisson=case['nu'])
    s.add_plate_section('P', 'C', thickness=case['t'], formulation=formulation)
    for i, (x, y) in enumerate(case['nodes']):
        s.add_node(f'N{i}', x, y)
    for k, (a, b, c) in enumerate(case['elems']):
        s.add_tri_element(f'T{k}', f'N{a}', f'N{b}', f'N{c}', 'P')
    sup = {}
    for f in case['fix']:
        key = (f['w'], f['tx'], f['ty'])
        if key not in sup:
            sup[key] = f'S{len(sup)}'
            s.add_support(sup[key], w=key[0], tx=key[1], ty=key[2])
        s.assign_support(f"N{f['n']}", sup[key])
    for sp in case['springs']:
        if abs(sp.get('ktxy', 0)) > 1e-9:
            raise ValueError('sprężyna sprzężona ktxy — xdfem2d jej nie obsługuje')
        s.add_node_spring(f"N{sp['node']}", kz=sp['kw'], ktx=sp['ktx'], kty=sp['kty'])
    for lc in case['cases']:
        s.add_load_case(lc['name'])
        for k, q in enumerate(lc['q']):
            if q:
                s.add_area_load(f'T{k}', lc['name'], pz=-q)
        for p in lc['point']:
            s.add_point_load(f"N{p['node']}", lc['name'], fz=-p['P'])
    return s.calculate()


def compare(case, res, formulation):
    rows = []
    for lc in case['cases']:
        disp = res['displacements'][lc['name']]
        w_x = np.array([abs(disp[f'N{i}'][0]) for i in range(len(case['nodes']))])
        w_t = np.abs(np.array(lc['w']))
        ts = res['tri_stress'][lc['name']]
        m_x = np.array([[ts[f'T{k}'][c] for c in ('mx', 'my', 'mxy')] for k in range(len(case['elems']))])
        m_t = np.array(lc['m'])
        # ten sam znak momentów? (konwencja: + rozciąga spód) — dopasowanie znaku po kierunku największego
        sgn = np.sign(np.sum(m_x[:, 0] * m_t[:, 0])) or 1.0
        Mref = np.max(np.abs(m_t))
        dM = np.max(np.abs(sgn * m_x - m_t)) / Mref
        # ugięcie maksymalne i różnica w węzłach (odniesiona do max)
        dw_max = (w_x.max() - w_t.max()) / w_t.max()
        dw = np.max(np.abs(w_x - w_t)) / w_t.max()
        # momenty ekstremalne (wartości do porównania z tablicami / inżynierskiego odczytu)
        rows.append(dict(case=case['id'], lc=lc['name'], form=formulation, w_tek=w_t.max() * 1e3, w_x=w_x.max() * 1e3,
                         dw_max=dw_max, dw=dw, Mmax_tek=m_t.max(), Mmax_x=(sgn * m_x).max(), Mmin_tek=m_t.min(),
                         Mmin_x=(sgn * m_x).min(), dM=dM, sign=int(sgn)))
    return rows


def main():
    cases = json.load(open(sys.argv[1]))
    rows = []
    for c in cases:
        for form in ('DKT', 'MITC3'):
            rows += compare(c, solve_xdfem(c, form), form)
    hdr = '| Przypadek | Obc. | xdfem2d | w_max TEK [mm] | w_max xdfem [mm] | Δw_max | max Δw (węzły) | M_max TEK | M_max xdfem | M_min TEK | M_min xdfem | max ΔM / M_max | Wynik |'
    lines = [hdr, '|' + '---|' * 13]
    ok_all = True
    for r in rows:
        ok = (r['dM'] <= 0.05 and abs(r['dw_max']) <= 0.10) if r['form'] == 'DKT' else abs(r['dw_max']) <= 0.10
        ok_all &= ok
        lines.append(f"| {r['case']} | {r['lc']} | {r['form']} | {r['w_tek']:.3f} | {r['w_x']:.3f} | {r['dw_max']*100:+.2f} % | {r['dw']*100:.2f} % | "
                     f"{r['Mmax_tek']:.2f} | {r['Mmax_x']:.2f} | {r['Mmin_tek']:.2f} | {r['Mmin_x']:.2f} | {r['dM']*100:.2f} % | {'zgodne' if ok else 'ROZBIEŻNE'} |")
    text = '\n'.join(lines)
    print(text)
    if len(sys.argv) > 2:
        open(sys.argv[2], 'w').write(text + '\n')
    sys.exit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
