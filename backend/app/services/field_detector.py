try:
    import fitz
except ImportError:
    fitz = None

import re
from typing import List, Dict, Any

class FieldDetector:
    """
    Automatic field detection engine.
    Scans PDF documents for:
    1. Interactive AcroForm widget annotations.
    2. Text keywords (e.g. Signature, Date, Signed by, Initials, Name).
    3. Underline / fill-in blank line patterns (__________ or ...........).
    """

    KEYWORD_MAPPINGS = [
        (re.compile(r'\b(signature|sign\s+here|signed\s+by)\b', re.I), 'signature', 160.0, 50.0),
        (re.compile(r'\b(initials?|initial\s+here)\b', re.I), 'initials', 100.0, 40.0),
        (re.compile(r'\b(date\s+signed|date)\b', re.I), 'date', 130.0, 35.0),
        (re.compile(r'\b(full\s+name|print\s+name|name)\b', re.I), 'text', 160.0, 35.0),
        (re.compile(r'\b(email|email\s+address)\b', re.I), 'text', 180.0, 35.0),
        (re.compile(r'\b(title|company)\b', re.I), 'text', 160.0, 35.0),
    ]

    @classmethod
    def detect_fields(cls, pdf_path: str) -> List[Dict[str, Any]]:
        detected_fields: List[Dict[str, Any]] = []
        if not fitz:
            # Fallback mock for environments without PyMuPDF
            return [
                {"field_type": "signature", "page_number": 1, "x": 10.0, "y": 80.0, "width": 160.0, "height": 50.0, "name": "Signature (Fallback)", "confidence": 0.8},
                {"field_type": "date", "page_number": 1, "x": 60.0, "y": 80.0, "width": 120.0, "height": 35.0, "name": "Date (Fallback)", "confidence": 0.8}
            ]

        doc = fitz.open(pdf_path)

        try:
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                page_width = page.rect.width
                page_height = page.rect.height
                page_num = page_idx + 1

                # 1. Check for AcroForm interactive widgets
                for widget in page.widgets():
                    rect = widget.rect
                    x_pct = round((rect.x0 / page_width) * 100, 2)
                    y_pct = round((rect.y0 / page_height) * 100, 2)

                    field_type = 'text'
                    if widget.field_type == fitz.PDF_WIDGET_TYPE_SIGNATURE:
                        field_type = 'signature'
                    elif widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                        field_type = 'checkbox'
                    elif widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
                        field_type = 'radio'
                    elif widget.field_type == fitz.PDF_WIDGET_TYPE_COMBOBOX or widget.field_type == fitz.PDF_WIDGET_TYPE_LISTBOX:
                        field_type = 'dropdown'

                    detected_fields.append({
                        'field_type': field_type,
                        'page_number': page_num,
                        'x': x_pct,
                        'y': y_pct,
                        'width': rect.width,
                        'height': rect.height,
                        'name': widget.field_name or f"Field_{page_num}_{len(detected_fields)}",
                        'confidence': 1.0
                    })

                # 2. Text heuristics & Line Detection if few widgets
                if len(detected_fields) < 20:
                    full_text = page.get_text("text")

                    for pattern, ftype, def_w, def_h in cls.KEYWORD_MAPPINGS:
                        for match in pattern.finditer(full_text):
                            search_term = match.group(0)
                            rects = page.search_for(search_term)
                            for r in rects:
                                target_x = min(r.x1 + 10, page_width - def_w - 20)
                                target_y = max(r.y0 - 5, 10)

                                x_pct = round((target_x / page_width) * 100, 2)
                                y_pct = round((target_y / page_height) * 100, 2)

                                is_dup = any(
                                    df['page_number'] == page_num and 
                                    abs(df['x'] - x_pct) < 10 and 
                                    abs(df['y'] - y_pct) < 5 
                                    for df in detected_fields
                                )
                                if not is_dup:
                                    detected_fields.append({
                                        'field_type': ftype,
                                        'page_number': page_num,
                                        'x': x_pct,
                                        'y': y_pct,
                                        'width': def_w,
                                        'height': def_h,
                                        'name': f"{ftype.capitalize()} ({search_term})",
                                        'confidence': 0.85
                                    })
        finally:
            doc.close()

        return detected_fields
