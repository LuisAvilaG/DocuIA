"""Generate fictitious, client-facing PDF correspondence for the archive demo."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


HERE = Path(__file__).resolve().parent
FONT_DIR = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("ArialDemo", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("ArialDemo-Bold", str(FONT_DIR / "arialbd.ttf")))
pdfmetrics.registerFontFamily("ArialDemo", normal="ArialDemo", bold="ArialDemo-Bold")

NAVY = colors.HexColor("#18314D")
TEAL = colors.HexColor("#167C82")
SLATE = colors.HexColor("#526276")
PALE = colors.HexColor("#F3F6F7")
RULE = colors.HexColor("#D5DEE3")

BODY = ParagraphStyle(
    "body", fontName="ArialDemo", fontSize=10.5, leading=16.5,
    textColor=NAVY, alignment=TA_LEFT,
)
SMALL = ParagraphStyle(
    "small", fontName="ArialDemo", fontSize=9, leading=13,
    textColor=SLATE, alignment=TA_LEFT,
)
DOCUMENTS = [
    {
        "file": "01-CARTA-101-2026.pdf",
        "kind": "CARTA", "code": "CARTA-101-2026", "date": "Lima, 12 de enero de 2026",
        "sender": "Concesionaria Proyecto Ejemplo S.A.",
        "recipient": "Supervisión del Proyecto",
        "subject": "Programa de desvío de tránsito - Estación Central",
        "reference": "Programa de obra del frente Estación Central",
        "paragraphs": [
            "Por medio de la presente remitimos para revisión el programa de desvío de tránsito correspondiente al frente de obra Estación Central. El plan contempla señalización temporal, rutas alternas para vehículos y medidas de seguridad peatonal durante las actividades previstas entre febrero y abril de 2026.",
            "Solicitamos a la Supervisión revisar el cronograma y confirmar sus observaciones técnicas antes del inicio de los trabajos. Los planos de circulación y el cuadro de fases forman parte del expediente de demostración.",
        ],
        "closing": "Agradecemos confirmar la recepción de esta comunicación.",
        "signer": "Coordinación de obra",
    },
    {
        "file": "02-INFORME-103-2026.pdf",
        "kind": "INFORME", "code": "INFORME-103-2026", "date": "Lima, 23 de enero de 2026",
        "sender": "Supervisión del Proyecto",
        "recipient": "Concesionaria Proyecto Ejemplo S.A.",
        "subject": "Evaluación técnica del programa de desvío de tránsito",
        "reference": "CARTA-101-2026, de 12 de enero de 2026",
        "paragraphs": [
            "La Supervisión evaluó el programa de desvío de tránsito remitido mediante CARTA-101-2026. El documento se refiere al frente de obra Estación Central y desarrolla rutas alternas, señalización temporal y medidas de seguridad para peatones.",
            "La propuesta atiende el objetivo general del frente de obra; sin embargo, debe incorporar un cruce peatonal adicional en el acceso norte y ajustar el horario de cierre parcial para reducir la afectación durante las horas de mayor tránsito.",
            "Se solicita remitir una versión revisada del cronograma y de los planos de circulación antes de emitir conformidad técnica.",
        ],
        "closing": "Este informe constituye una observación técnica, no una aprobación del plan.",
        "signer": "Jefatura de supervisión",
    },
    {
        "file": "03-CARTA-115-2026.pdf",
        "kind": "CARTA", "code": "CARTA-115-2026", "date": "Lima, 30 de enero de 2026",
        "sender": "Concesionaria Proyecto Ejemplo S.A.",
        "recipient": "Supervisión del Proyecto",
        "subject": "Respuesta a observaciones del desvío de tránsito",
        "reference": "INFORME-103-2026 y CARTA-101-2026",
        "paragraphs": [
            "En respuesta a INFORME-103-2026, relativo al programa remitido en CARTA-101-2026, confirmamos que la versión revisada incorpora un cruce peatonal adicional en el acceso norte y ajusta el horario de cierre parcial del frente de obra Estación Central.",
            "La revisión conserva las rutas alternas y las medidas de señalización previstas originalmente. El detalle actualizado menciona además CARTA-199-2026, cuya copia todavía no se ha incorporado al archivo documental.",
            "Solicitamos a la Supervisión confirmar la recepción del cronograma revisado e indicar si las observaciones técnicas han quedado atendidas.",
        ],
        "closing": "Quedamos atentos a su respuesta.",
        "signer": "Coordinación de obra",
    },
]


def paragraph(pdf: canvas.Canvas, text: str, x: float, y: float, width: float, style=BODY) -> float:
    item = Paragraph(text, style)
    _, height = item.wrap(width, 1000)
    item.drawOn(pdf, x, y - height)
    return y - height


def draw_document(document: dict[str, object]) -> None:
    target = HERE / str(document["file"])
    pdf = canvas.Canvas(str(target), pagesize=A4, pageCompression=1)
    width, height = A4
    left, right = 56, width - 56
    usable = right - left

    pdf.setFillColor(NAVY)
    pdf.rect(0, height - 16, width, 16, stroke=0, fill=1)
    pdf.setFont("ArialDemo-Bold", 9)
    pdf.setFillColor(TEAL)
    pdf.drawString(left, height - 55, "EXPEDIENTE DE CORRESPONDENCIA")
    pdf.setFont("ArialDemo", 8.5)
    pdf.setFillColor(SLATE)
    pdf.drawRightString(right, height - 55, "ESCENARIO FICTICIO  /  DEMOSTRACIÓN DOCUIA")
    pdf.setStrokeColor(RULE)
    pdf.line(left, height - 66, right, height - 66)

    pdf.setFont("ArialDemo-Bold", 12)
    pdf.setFillColor(NAVY)
    pdf.drawString(left, height - 108, str(document["kind"]))
    pdf.setFont("ArialDemo-Bold", 20)
    pdf.drawString(left, height - 139, str(document["code"]))
    pdf.setFont("ArialDemo", 9.5)
    pdf.setFillColor(SLATE)
    pdf.drawRightString(right, height - 109, str(document["date"]))

    box_top = height - 165
    box_height = 104
    pdf.setFillColor(PALE)
    pdf.roundRect(left, box_top - box_height, usable, box_height, 7, stroke=0, fill=1)
    rows = [
        ("DE", document["sender"]),
        ("PARA", document["recipient"]),
        ("ASUNTO", document["subject"]),
        ("REFERENCIA", document["reference"]),
    ]
    for index, (label, value) in enumerate(rows):
        y = box_top - 20 - index * 25
        pdf.setFont("ArialDemo-Bold", 8)
        pdf.setFillColor(SLATE)
        pdf.drawString(left + 14, y, label)
        pdf.setFont("ArialDemo", 9.2)
        pdf.setFillColor(NAVY)
        pdf.drawString(left + 105, y, str(value))

    y = box_top - box_height - 38
    y = paragraph(pdf, "Señores:", left, y, usable)
    y -= 18
    for body in document["paragraphs"]:
        y = paragraph(pdf, str(body), left, y, usable)
        y -= 19
    y -= 2
    y = paragraph(pdf, str(document["closing"]), left, y, usable)
    y -= 39

    pdf.setStrokeColor(RULE)
    pdf.line(left, y, left + 192, y)
    pdf.setFont("ArialDemo-Bold", 9)
    pdf.setFillColor(NAVY)
    pdf.drawString(left, y - 17, str(document["signer"]))
    pdf.setFont("ArialDemo", 8.5)
    pdf.setFillColor(SLATE)
    pdf.drawString(left, y - 31, str(document["sender"]))

    footer_y = 42
    pdf.setStrokeColor(RULE)
    pdf.line(left, footer_y + 13, right, footer_y + 13)
    paragraph(
        pdf,
        "Documento ficticio creado exclusivamente para demostrar el rastreo de referencias. No corresponde a una comunicación real ni tiene validez contractual.",
        left, footer_y + 1, usable - 38, SMALL,
    )
    pdf.setFont("ArialDemo", 8)
    pdf.drawRightString(right, footer_y - 19, "1 / 1")
    if y < footer_y + 82:
        raise ValueError(f"El contenido de {document['file']} invade el pie de página")
    pdf.save()
    print(target)


if __name__ == "__main__":
    for item in DOCUMENTS:
        draw_document(item)
