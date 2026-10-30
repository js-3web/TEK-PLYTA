"""Generuje wzorzec DXF dla użytkownika i pliki testowe.

Narzędzie deweloperskie (nie trafia do programu). Wymaga: pip install ezdxf==1.4.2 (licencja MIT).
Uruchom z folderu projektu:  python3 tools/make-dxf.py
Wynik: assets/TEK-PLYTA_wzorzec.dxf, tests/fixtures/*.dxf
"""
import ezdxf
from ezdxf.enums import TextEntityAlignment
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYERS = [  # nazwa, kolor ACI, opis do legendy
    ("TP_OBRYS", 7, "krawędź płyty — dokładnie 1 zamknięta polilinia (łuki dozwolone)"),
    ("TP_OTWOR", 6, "otwór — zamknięta polilinia lub okrąg, etykieta O1, O2… (opcjonalna)"),
    ("TP_SLUP", 1, "przekrój słupa — prostokąt (polilinia) lub okrąg, etykieta S1, S2…"),
    ("TP_SCIANA", 3, "ściana pod płytą — linia/polilinia w osi ściany, etykieta W1, W2…"),
    ("TP_KRAWEDZ", 4, "krawędź podparta/utwierdzona — linia na obrysie, etykieta K1, K2…"),
    ("TP_OBC_POW", 5, "strefa obciążenia powierzchniowego — zamknięta polilinia, etykieta Q1, Q2…"),
    ("TP_OBC_LIN", 30, "obciążenie liniowe — linia/polilinia, etykieta L1, L2…"),
    ("TP_OBC_SKUP", 2, "siła skupiona — punkt, etykieta P1, P2…"),
    ("TP_INFO", 8, "opisy, wymiary — pomijane przez program"),
]


def new_doc(version="R2010", units=4):
    doc = ezdxf.new(version, setup=False)
    if version != "R12":
        doc.header["$INSUNITS"] = units
    for name, color, _ in LAYERS:
        doc.layers.add(name, color=color)
    return doc


def label(msp, text, x, y, h=300, layer="TP_INFO"):
    msp.add_text(text, height=h, dxfattribs={"layer": layer}).set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)


def rect(msp, x0, y0, x1, y1, layer):
    msp.add_lwpolyline([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], close=True, dxfattribs={"layer": layer})


# Przykładowa płyta (mm): kształt L, krawędź dolna łukowa, 7 słupów (1 okrągły), ściana, otwór,
# krawędź podparta, 2 strefy obciążeń, obciążenie liniowe, siła skupiona.
OUTLINE = [(0, 0, 0.1), (13800, 0, 0), (13800, 6700, 0), (24000, 6700, 0), (24000, 14200, 0), (0, 14200, 0)]
COLUMNS = [  # etykieta, środek, wymiar (None = okrąg o średnicy d)
    ("S1", (6900, 3500), 400), ("S2", (6900, 10700), 400), ("S3", (13600, 6900), 400),
    ("S4", (13600, 14000), 400), ("S5", (19000, 10450), None), ("S6", (23800, 6900), 400),
    ("S7", (23800, 14000), 400),
]


def template():
    doc = new_doc()
    msp = doc.modelspace()
    msp.add_lwpolyline(OUTLINE, format="xyb", close=True, dxfattribs={"layer": "TP_OBRYS"})
    rect(msp, 3000, 9500, 4200, 10400, "TP_OTWOR"); label(msp, "O1", 3600, 9950, 250)
    for name, (cx, cy), b in COLUMNS:
        if b is None:
            msp.add_circle((cx, cy), 250, dxfattribs={"layer": "TP_SLUP"})
        else:
            rect(msp, cx - b / 2, cy - b / 2, cx + b / 2, cy + b / 2, "TP_SLUP")
        label(msp, name, cx + 450, cy - 450, 250)
    msp.add_line((125, 600), (125, 14200), dxfattribs={"layer": "TP_SCIANA"}); label(msp, "W1", 500, 12500, 250)
    msp.add_line((24000, 7100), (24000, 13800), dxfattribs={"layer": "TP_KRAWEDZ"}); label(msp, "K1", 23500, 10450, 250)
    msp.add_lwpolyline(OUTLINE, format="xyb", close=True, dxfattribs={"layer": "TP_OBC_POW"}); label(msp, "Q1", 10000, 12500, 300)
    rect(msp, 1000, 1000, 5500, 5500, "TP_OBC_POW"); label(msp, "Q2", 3250, 3250, 300)
    msp.add_line((9500, 800), (9500, 6000), dxfattribs={"layer": "TP_OBC_LIN"}); label(msp, "L1", 9900, 3500, 250)
    msp.add_point((20000, 12000), dxfattribs={"layer": "TP_OBC_SKUP"}); label(msp, "P1", 20400, 12300, 250)
    # legenda
    msp.add_text("TEK-PLYTA — WZORZEC DXF (jednostki: mm)", height=500, dxfattribs={"layer": "TP_INFO"}).set_placement((0, 17000))
    lines = ["Zasady:", "1. Rysuj na warstwach TP_*. Etykieta (tekst) wewnątrz lub obok obiektu.",
             "2. Obrys, otwory, słupy, strefy Q: polilinie ZAMKNIĘTE.",
             "3. Wartości (beton, obciążenia, wysokości słupów) wpisujesz w programie, nie w DXF.",
             "4. Bloki rozbij (ROZBIJ). Zapisz jako DXF 2010 lub nowszy.", "", "Warstwy:"]
    lines += [f"{n} — {d}" for n, _, d in LAYERS]
    msp.add_mtext("\\P".join(lines), dxfattribs={"layer": "TP_INFO", "char_height": 250}).set_location((26000, 14200))
    out = ROOT / "assets" / "TEK-PLYTA_wzorzec.dxf"
    out.parent.mkdir(exist_ok=True)
    doc.saveas(out)
    return out


def fixtures():
    fx = ROOT / "tests" / "fixtures"
    fx.mkdir(parents=True, exist_ok=True)

    # 1. Płyta kwadratowa 6 × 6 m, wszystkie krawędzie K1 (test z Timoshenką), Q1 na całej płycie
    doc = new_doc(); msp = doc.modelspace()
    rect(msp, 0, 0, 6000, 6000, "TP_OBRYS")
    msp.add_lwpolyline([(0, 0), (6000, 0), (6000, 6000), (0, 6000)], close=True, dxfattribs={"layer": "TP_KRAWEDZ"})
    label(msp, "K1", 3000, 300, 200)
    rect(msp, 0, 0, 6000, 6000, "TP_OBC_POW"); label(msp, "Q1", 3000, 3000)
    doc.saveas(fx / "kwadrat-6x6.dxf")

    # 2. Ten sam kwadrat w metrach, zapis R12 (stara POLYLINE), etykiety jako MTEXT z formatowaniem
    doc = new_doc("R12"); msp = doc.modelspace()
    msp.add_polyline2d([(0, 0), (6, 0), (6, 6), (0, 6)], close=True, dxfattribs={"layer": "TP_OBRYS"})
    msp.add_line((0, 0), (6, 0), dxfattribs={"layer": "TP_KRAWEDZ"})
    msp.add_text("K1", height=0.2, dxfattribs={"layer": "TP_INFO"}).set_placement((3, 0.3))
    doc.saveas(fx / "kwadrat-r12-metry.dxf")

    # 3. Płyta na 4 słupach + MTEXT z formatowaniem + łuk na obrysie + słup okrągły
    doc = new_doc(); msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0, 0), (8000, 0, 0.2), (8000, 8000, 0), (0, 8000, 0)], format="xyb", close=True, dxfattribs={"layer": "TP_OBRYS"})
    for i, (cx, cy) in enumerate([(2000, 2000), (6000, 2000), (2000, 6000)]):
        rect(msp, cx - 200, cy - 200, cx + 200, cy + 200, "TP_SLUP")
        msp.add_mtext(f"{{\\fArial|b1;\\LS{i + 1}\\l}}", dxfattribs={"layer": "TP_INFO", "char_height": 200}).set_location((cx + 300, cy + 300))
    msp.add_circle((6000, 6000), 250, dxfattribs={"layer": "TP_SLUP"}); label(msp, "S4", 6400, 6400, 200)
    rect(msp, 0, 0, 8000, 8000, "TP_OBC_POW"); label(msp, "Q1", 4000, 4000)
    msp.add_point((4000, 6000), dxfattribs={"layer": "TP_OBC_SKUP"}); label(msp, "P1", 4300, 6300, 200)
    doc.saveas(fx / "slupy-luk.dxf")

    # 4. Plik z błędami
    doc = new_doc(); msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10000, 0), (10000, 6000), (0, 6000)], close=False, dxfattribs={"layer": "TP_OBRYS"})  # niezamknięty
    rect(msp, 2000, 2000, 2400, 2400, "TP_SLUP"); label(msp, "S1", 2600, 2600, 200)
    rect(msp, 5000, 2000, 5400, 2400, "TP_SLUP"); label(msp, "S1", 5600, 2600, 200)  # zdublowana etykieta
    rect(msp, 8000, 4000, 8400, 4400, "TP_SLUP")                                     # brak etykiety
    rect(msp, 11000, 2000, 11400, 2400, "TP_SLUP"); label(msp, "S9", 11600, 2600, 200)  # poza płytą
    rect(msp, 9500, 500, 10500, 1500, "TP_OTWOR")                                    # przecina obrys
    msp.add_line((0, 0), (0, 6000), dxfattribs={"layer": "MOJA_WARSTWA"})            # nieznana warstwa
    blk = doc.blocks.new("BLOK"); blk.add_line((0, 0), (1, 1))
    msp.add_blockref("BLOK", (1000, 1000), dxfattribs={"layer": "TP_INFO"})          # blok
    doc.saveas(fx / "bledy.dxf")

    # 5. Płyta bez żadnej podpory
    doc = new_doc(); msp = doc.modelspace()
    rect(msp, 0, 0, 5000, 4000, "TP_OBRYS")
    doc.saveas(fx / "bez-podpor.dxf")


if __name__ == "__main__":
    print("wzorzec:", template())
    fixtures()
    print("pliki testowe: tests/fixtures/")
