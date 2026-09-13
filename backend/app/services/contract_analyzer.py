import os
import re
from typing import Dict, Any, List, Optional

class ContractAnalyzer:
    """
    Intelligent contract comprehension and risk assessment engine.
    Extracts key commercial terms, classifies clauses, and flags potential risks
    without external API dependencies.
    """

    AGREEMENT_TYPES = [
        (r"non[\s-]disclosure|confidentiality|nda", "Non-Disclosure Agreement (NDA)"),
        (r"master\s+services|msa", "Master Services Agreement (MSA)"),
        (r"statement\s+of\s+work|sow", "Statement of Work (SOW)"),
        (r"employment\s+agreement|offer\s+letter|employment\s+contract", "Employment Agreement"),
        (r"software\s+as\s+a\s+service|saas|software\s+license", "SaaS & Software License Agreement"),
        (r"commercial\s+lease|lease\s+agreement|tenancy", "Commercial Lease Agreement"),
        (r"consulting\s+agreement|independent\s+contractor", "Consulting & Advisory Agreement"),
        (r"vendor\s+agreement|supplier\s+contract", "Vendor & Supplier Agreement"),
    ]

    GOVERNING_LAW_PATTERNS = [
        r"governed\s+by(?:,\s+and\s+construed\s+in\s+accordance\s+with,)?\s+the\s+laws\s+of\s+([A-Z][a-zA-Z\s,]+?)(?:\.|\;|\n|without)",
        r"laws\s+of\s+the\s+State\s+of\s+([A-Z][a-zA-Z]+)",
        r"laws\s+of\s+([A-Z][a-zA-Z\s]+)\s+shall\s+govern",
        r"jurisdiction\s+of\s+the\s+courts\s+of\s+([A-Z][a-zA-Z\s,]+)",
    ]

    TERMINATION_PATTERNS = [
        r"(\d+\s+(?:days?|months?))\s+(?:prior\s+)?written\s+notice(?:\s+of\s+termination)?",
        r"(?:terminate|termination)\s+(?:upon|by\s+giving)\s+(\d+\s+(?:days?|months?))(?:\s+written\s+notice)?",
        r"notice\s+period\s+of\s+(\d+\s+(?:days?|months?))",
    ]

    PAYMENT_PATTERNS = [
        r"net\s+(\d+)\s+days?",
        r"within\s+(\d+)\s+days\s+of\s+(?:receipt|invoice)",
        r"payment\s+shall\s+be\s+due\s+(\d+\s+days)",
    ]

    @classmethod
    def analyze_text(cls, full_text: str, page_count: int = 1) -> Dict[str, Any]:
        """
        Analyzes plain contract text and generates a structured intelligence report.
        """
        words = full_text.split()
        word_count = len(words)
        reading_time_minutes = max(1, round(word_count / 200))

        # 1. Classify agreement
        doc_type = "Commercial Contract"
        lower_text = full_text.lower()
        for pattern, label in cls.AGREEMENT_TYPES:
            if re.search(pattern, lower_text):
                doc_type = label
                break

        # 2. Extract Governing Law
        governing_law = "Not specified"
        for pat in cls.GOVERNING_LAW_PATTERNS:
            match = re.search(pat, full_text, re.IGNORECASE)
            if match:
                clean_law = match.group(1).strip().replace("\n", " ")
                if len(clean_law) < 60:
                    governing_law = clean_law
                    break

        # 3. Extract Termination Notice
        termination_notice = "Standard mutual notice"
        for pat in cls.TERMINATION_PATTERNS:
            match = re.search(pat, lower_text)
            if match:
                termination_notice = match.group(1).strip()
                break

        # 4. Extract Payment Terms
        payment_terms = "Standard commercial schedule"
        for pat in cls.PAYMENT_PATTERNS:
            match = re.search(pat, lower_text)
            if match:
                payment_terms = f"Net {match.group(1)} days"
                break

        # 5. High-Value Risk Analysis
        risk_flags = []
        
        # Evergreen auto-renewal check
        if re.search(r"automatic(?:ally)?\s+renew|renewal\s+period|shall\s+automatically\s+extend", lower_text):
            risk_flags.append({
                "category": "Commitment Term",
                "severity": "medium",
                "title": "Automatic Renewal (Evergreen Clause)",
                "summary": "This contract automatically renews unless written cancellation notice is delivered before the renewal deadline."
            })

        # Liability cap check
        if re.search(r"unlimited\s+liability|without\s+limitation\s+of\s+liability|in\s+no\s+event\s+shall\s+liability\s+be\s+capped", lower_text):
            risk_flags.append({
                "category": "Liability & Exposure",
                "severity": "high",
                "title": "Uncapped Liability Exposure",
                "summary": "Contains broad liability provisions that may not restrict total damages to standard contractual fees paid."
            })
        elif re.search(r"aggregate\s+liability|limitation\s+of\s+liability", lower_text):
            risk_flags.append({
                "category": "Liability & Exposure",
                "severity": "low",
                "title": "Capped Liability Defined",
                "summary": "Standard limitation of liability clause is present, typically capping damages to fees paid."
            })

        # Indemnification check
        if re.search(r"indemnif(?:y|ication)|hold\s+harmless", lower_text):
            risk_flags.append({
                "category": "Indemnity",
                "severity": "medium",
                "title": "Indemnification Obligations",
                "summary": "Requires one or both parties to indemnify against third-party claims or breaches."
            })

        # Non-compete / non-solicitation check
        if re.search(r"non[\s-]compete|covenant\s+not\s+to\s+compete|non[\s-]solicitation", lower_text):
            risk_flags.append({
                "category": "Covenants",
                "severity": "medium",
                "title": "Non-Solicitation or Restrictive Covenants",
                "summary": "Contains restrictions regarding solicitation of employees, contractors, or customers."
            })

        # Determine overall risk score
        high_count = sum(1 for r in risk_flags if r["severity"] == "high")
        med_count = sum(1 for r in risk_flags if r["severity"] == "medium")
        if high_count > 0:
            overall_risk = "Elevated Risk Review Recommended"
            risk_badge = "amber"
        elif med_count > 1:
            overall_risk = "Moderate Risk (Standard Commercial Terms)"
            risk_badge = "blue"
        else:
            overall_risk = "Low Risk (Standard Agreement)"
            risk_badge = "emerald"

        return {
            "is_analyzed": True,
            "document_type": doc_type,
            "page_count": page_count,
            "word_count": word_count,
            "estimated_read_minutes": reading_time_minutes,
            "overall_risk_assessment": overall_risk,
            "risk_badge": risk_badge,
            "key_commercial_terms": {
                "governing_law": governing_law,
                "termination_notice": termination_notice,
                "payment_terms": payment_terms,
                "dispute_resolution": "Courts of competent jurisdiction" if "court" in lower_text else "Arbitration"
            },
            "risk_flags": risk_flags
        }

    @classmethod
    def analyze_pdf(cls, pdf_path: str) -> Dict[str, Any]:
        """
        Parses a PDF contract and generates an executive intelligence report.
        """
        if not os.path.exists(pdf_path):
            return {"error": "Document not found", "is_analyzed": False}

        try:
            import fitz
            doc = fitz.open(pdf_path)
            total_pages = len(doc)
            full_text = ""
            for page_idx in range(total_pages):
                full_text += f"\n{doc[page_idx].get_text()}"
            doc.close()
            return cls.analyze_text(full_text, page_count=total_pages)
        except ImportError:
            # Fallback if fitz is not installed in local environment
            try:
                import pypdf
                reader = pypdf.PdfReader(pdf_path)
                total_pages = len(reader.pages)
                full_text = "\n".join(p.extract_text() or "" for p in reader.pages)
                return cls.analyze_text(full_text, page_count=total_pages)
            except Exception as e:
                return {
                    "is_analyzed": False,
                    "error": f"PDF parsing library unavailable: {e}"
                }
