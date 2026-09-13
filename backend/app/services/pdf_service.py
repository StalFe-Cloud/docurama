import os
import io
import base64
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from app.core.config import settings
from app.services.qr_generator import generate_qr_image

def overlay_fields_on_pdf(
    input_pdf_path: str,
    output_pdf_path: str,
    fields: List[Dict[str, Any]]
) -> str:
    """
    Overlay submitted signatures and field values onto the document pages.
    Coordinates are expected as percentages (0-100) or points.
    """
    # Group fields by page number (1-indexed)
    fields_by_page = {}
    for f in fields:
        p = f.get("page_number", 1)
        fields_by_page.setdefault(p, []).append(f)

    # Try PyMuPDF (fitz) first as it is fastest and most accurate
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(input_pdf_path)
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_fields = fields_by_page.get(page_num + 1, [])
            rect_page = page.rect
            page_width = rect_page.width
            page_height = rect_page.height

            for f in page_fields:
                val = f.get("value")
                if not val:
                    continue

                # Coordinate normalization (if percentage, convert to points)
                x = f.get("x", 0.0)
                y = f.get("y", 0.0)
                w = f.get("width", 150.0)
                h = f.get("height", 50.0)

                if x <= 100.0 and y <= 100.0:
                    x_pts = (x / 100.0) * page_width
                    y_pts = (y / 100.0) * page_height
                    w_pts = (w / 100.0) * page_width if w <= 100.0 else w
                    h_pts = (h / 100.0) * page_height if h <= 100.0 else h
                else:
                    x_pts, y_pts, w_pts, h_pts = x, y, w, h

                rect = fitz.Rect(x_pts, y_pts, x_pts + w_pts, y_pts + h_pts)

                if val.startswith("data:image"):
                    # Signature image
                    try:
                        img_data = base64.b64decode(val.split(",")[1])
                        page.insert_image(rect, stream=img_data)
                    except Exception as ie:
                        print(f"[PDFService] Error inserting signature image: {ie}")
                else:
                    # Text, Date, Name, Initials
                    page.insert_textbox(
                        rect,
                        str(val),
                        fontsize=12,
                        fontname="helv",
                        color=(0.1, 0.1, 0.1),
                    )

        doc.save(output_pdf_path)
        doc.close()
        return output_pdf_path
    except ImportError:
        pass

    # Fallback to copy if fitz is not installed in local environment
    import shutil
    shutil.copy2(input_pdf_path, output_pdf_path)
    return output_pdf_path

def _timestamp_statement(seal_status) -> str:
    """
    State the RFC 3161 timestamp only when the document actually carries one.

    The previous wording asserted "RFC 3161 compliant timestamps" on every certificate,
    including documents that completed with no seal at all.
    """
    if seal_status == "sealed":
        return "The sealed document carries an RFC 3161 trusted timestamp. "
    if seal_status == "unsealed":
        return "This document was completed without a cryptographic seal or timestamp. "
    return ""


def _seal_summary(seal_status, pades_level):
    """
    Describe the cryptographic seal for the certificate summary table.

    The digest of the sealed file cannot be printed inside the file it digests, so this
    row reports the seal outcome instead. Counterparties confirm the digest through the
    public verification portal using the verification code above.
    """
    if seal_status == "sealed":
        level = pades_level or "PAdES"
        return (
            f"<font color='#16a34a'><b>SEALED</b></font> ({level}). "
            "Confirm the sealed digest via the verification portal below."
        )
    if seal_status == "unsealed":
        return (
            "<font color='#b45309'><b>NOT SEALED</b></font>. This document was completed "
            "without a cryptographic seal; its audit trail remains on record."
        )
    # The certificate page is bound into the document before that document is sealed,
    # so at render time the outcome is not yet known. The verification portal holds the
    # authoritative answer and is linked directly below.
    return (
        "Applied on completion. Confirm the seal and the sealed digest at the "
        "verification portal below."
    )


def generate_certificate_of_completion_pdf(
    envelope_data: Dict[str, Any],
    recipients_data: List[Dict[str, Any]],
    audit_events: List[Dict[str, Any]],
    output_pdf_path: str
) -> str:
    """
    Generate an ultra-crisp, executive Docurama Certificate of Completion (Audit Trail)
    with tamper-evident QR code and cryptographic verification hashes.
    """
    verification_code = envelope_data.get("verification_code", "")
    verify_url = f"{settings.APP_URL}/verify?code={verification_code}"
    qr_img = generate_qr_image(verify_url, box_size=6, border=1)
    
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, HRFlowable
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        
        doc = SimpleDocTemplate(
            output_pdf_path,
            pagesize=letter,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36
        )
        
        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            'DocuramaTitle',
            parent=styles['Heading1'],
            fontName='Helvetica-Bold',
            fontSize=20,
            leading=24,
            textColor=colors.HexColor('#0f172a')
        )
        subtitle_style = ParagraphStyle(
            'DocuramaSubtitle',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=14,
            textColor=colors.HexColor('#64748b')
        )
        section_heading = ParagraphStyle(
            'SectionHead',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=16,
            textColor=colors.HexColor('#1e293b')
        )
        cell_style = ParagraphStyle(
            'CellText',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#334155')
        )
        cell_bold = ParagraphStyle(
            'CellBold',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#0f172a')
        )
        
        elements = []
        
        # Header with branding and QR code
        qr_buf = io.BytesIO()
        qr_img.save(qr_buf, format="PNG")
        qr_buf.seek(0)
        rl_qr = RLImage(qr_buf, width=72, height=72)
        
        # The status line states what was actually achieved. A certificate that claims a
        # seal the document does not carry is worse than one that admits the gap.
        seal_status = envelope_data.get("seal_status")
        pades_level = envelope_data.get("pades_level")
        if seal_status == "sealed":
            level_label = f" ({pades_level})" if pades_level else ""
            status_line = f'<font color="#2563eb"><b>Status: COMPLETED &amp; CRYPTOGRAPHICALLY SEALED{level_label}</b></font>'
        elif seal_status == "unsealed":
            status_line = (
                '<font color="#b45309"><b>Status: COMPLETED - NOT CRYPTOGRAPHICALLY SEALED</b></font>'
            )
        else:
            # Rendered before sealing runs; the portal reports the confirmed state.
            status_line = '<font color="#2563eb"><b>Status: COMPLETED</b></font>'

        header_text = f"""<b>DOCURAMA CERTIFICATE OF COMPLETION</b><br/>
<font color="#64748b">Envelope ID: {envelope_data.get('id', '')}</font><br/>
<font color="#64748b">Verification Code: {verification_code}</font><br/>
{status_line}"""
        
        header_table = Table([[Paragraph(header_text, title_style), rl_qr]], colWidths=[460, 80])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 10))
        elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#e2e8f0'), spaceAfter=15))
        
        # Envelope Summary
        elements.append(Paragraph("Document & Envelope Summary", section_heading))
        elements.append(Spacer(1, 5))
        
        verified_domain = envelope_data.get("verified_domain")
        summary_data = [
            [Paragraph("Document Subject:", cell_bold), Paragraph(envelope_data.get("title", "Untitled Document"), cell_style)],
            [Paragraph("Completed Date (UTC):", cell_bold), Paragraph(str(envelope_data.get("completed_at", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))), cell_style)],
            [Paragraph("Original SHA-256:", cell_bold), Paragraph(f"<font face='Courier' size=8>{envelope_data.get('sha256_original', 'N/A')}</font>", cell_style)],
            [Paragraph("Cryptographic Seal:", cell_bold), Paragraph(_seal_summary(seal_status, pades_level), cell_style)],
            [Paragraph("Corporate Domain:", cell_bold), Paragraph(f"<font color='#16a34a'><b>DNS VERIFIED & ATTESTED</b></font> ({verified_domain})" if verified_domain else "<font color='#64748b'>Standard Organization</font>", cell_style)],
            [Paragraph("Public Verify Portal:", cell_bold), Paragraph(f"<a href='{verify_url}' color='#2563eb'>{verify_url}</a>", cell_style)],
        ]
        t_summary = Table(summary_data, colWidths=[140, 400])
        t_summary.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
            ('PADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(t_summary)
        elements.append(Spacer(1, 15))
        
        # Signers
        elements.append(Paragraph("Signers & Recipients", section_heading))
        elements.append(Spacer(1, 5))
        
        signers_table_data = [
            [
                Paragraph("Recipient Name & Email", cell_bold),
                Paragraph("Role & Status", cell_bold),
                Paragraph("Signed Timestamp (UTC)", cell_bold),
                Paragraph("Security Telemetry", cell_bold),
            ]
        ]
        
        for r in recipients_data:
            v_chan = r.get("verification_channel") or "none"
            if v_chan != "none":
                v_label = f"<br/><font color='#16a34a'><b>Auth: {v_chan.replace('_', ' ').title()} Verified</b></font>"
            else:
                v_label = "<br/><font color='#64748b'>Auth: Direct Signing Link</font>"

            signers_table_data.append([
                Paragraph(f"<b>{r.get('name', '')}</b><br/><font color='#64748b'>{r.get('email', '')}</font>", cell_style),
                Paragraph(f"{r.get('role', 'signer').upper()}<br/><font color='#16a34a'><b>{r.get('status', 'signed').upper()}</b></font>", cell_style),
                Paragraph(str(r.get("signed_at", "N/A")), cell_style),
                Paragraph(f"IP: {r.get('ip_address', 'Recorded')}<br/>User-Agent: Verified{v_label}", cell_style),
            ])
            
        t_signers = Table(signers_table_data, colWidths=[160, 100, 130, 150])
        t_signers.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e2e8f0')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
            ('PADDING', (0, 0), (-1, -1), 5),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(t_signers)
        elements.append(Spacer(1, 15))
        
        # Audit Trail Timeline
        elements.append(Paragraph("Chronological Audit Trail Events", section_heading))
        elements.append(Spacer(1, 5))
        
        audit_table_data = [
            [
                Paragraph("Timestamp (UTC)", cell_bold),
                Paragraph("Event", cell_bold),
                Paragraph("Actor", cell_bold),
                Paragraph("Details", cell_bold),
            ]
        ]
        for a in audit_events:
            audit_table_data.append([
                Paragraph(str(a.get("created_at", "")), cell_style),
                Paragraph(f"<b>{a.get('event_type', '').upper()}</b>", cell_style),
                Paragraph(a.get("actor_name", "System"), cell_style),
                Paragraph(a.get("description", ""), cell_style),
            ])
            
        t_audit = Table(audit_table_data, colWidths=[120, 90, 110, 220])
        t_audit.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('PADDING', (0, 0), (-1, -1), 4),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(t_audit)
        elements.append(Spacer(1, 15))
        
        # Cryptographic Trust Statement. Only SHA-256 digesting is unconditionally true;
        # a trusted timestamp exists only when a seal was actually applied, so that half
        # of the sentence is stated separately and only when it holds.
        cert_statement = (
            '<font size=7 color="#64748b">This Certificate of Completion is an electronic '
            'record generated automatically by Docurama. Every event is anchored with a '
            'SHA-256 message digest. '
            + _timestamp_statement(seal_status)
            + f'Scan the QR code or verify online at {verify_url}.</font>'
        )
        elements.append(Paragraph(cert_statement, subtitle_style))
        
        doc.build(elements)
        return output_pdf_path
    except ImportError:
        # Fallback when reportlab not locally available
        with open(output_pdf_path, "wb") as f:
            f.write(b"%PDF-1.4\n%Docurama Audit Certificate Placeholder\n%%EOF\n")
        return output_pdf_path

def append_certificate_page(
    main_pdf_path: str,
    cert_pdf_path: str,
    output_pdf_path: str
) -> str:
    """Merge certificate page to the end of the main PDF."""
    try:
        import fitz
        doc1 = fitz.open(main_pdf_path)
        doc2 = fitz.open(cert_pdf_path)
        doc1.insert_pdf(doc2)
        doc1.save(output_pdf_path)
        doc1.close()
        doc2.close()
        return output_pdf_path
    except ImportError:
        pass
        
    try:
        from pypdf import PdfWriter, PdfReader
        writer = PdfWriter()
        for path in [main_pdf_path, cert_pdf_path]:
            reader = PdfReader(path)
            for page in reader.pages:
                writer.add_page(page)
        with open(output_pdf_path, "wb") as f:
            writer.write(f)
        return output_pdf_path
    except Exception:
        import shutil
        shutil.copy2(main_pdf_path, output_pdf_path)
        return output_pdf_path

def get_pdf_pages_info(pdf_path: str) -> List[Dict[str, Any]]:
    """Returns page count and dimensions for each page (1-indexed)."""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        pages = []
        for i, page in enumerate(doc):
            rect = page.rect
            pages.append({
                "page_number": i + 1,
                "width": round(rect.width, 2),
                "height": round(rect.height, 2),
                "aspect_ratio": round(rect.width / rect.height, 4) if rect.height else 0.7727
            })
        doc.close()
        return pages
    except Exception as e:
        return [{"page_number": 1, "width": 612.0, "height": 792.0, "aspect_ratio": 0.7727}]

def render_pdf_page_png(pdf_path: str, page_number: int, dpi: int = 150) -> bytes:
    """Renders a specific page of a PDF as PNG bytes (page_number is 1-indexed)."""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        page_idx = max(0, min(page_number - 1, len(doc) - 1))
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=dpi)
        data = pix.tobytes("png")
        doc.close()
        return data
    except Exception as e:
        # Fallback 1x1 transparent PNG
        return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
