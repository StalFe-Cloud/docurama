import pytest
from app.services.contract_analyzer import ContractAnalyzer

SAMPLE_NDA_TEXT = """
MUTUAL NON-DISCLOSURE AGREEMENT
This Mutual Non-Disclosure Agreement ("Agreement") is made and entered into by and between
Party A Inc. and Counterparty LLC.

1. Purpose and Term. This Agreement shall govern confidential disclosures. This Agreement shall
automatically renew for consecutive 1-year terms unless 30 days written notice of termination
is provided by either party.

2. Governing Law. This Agreement shall be governed by and construed in accordance with
the laws of the State of Delaware without regard to conflict of law principles.

3. Payment Terms. Reimbursable evaluation expenses shall be paid net 30 days.

4. Limitation of Liability. Except for breach of confidentiality, neither party's aggregate
liability under this Agreement shall exceed the fees paid.

5. Non-Solicitation. Neither party shall solicit the employees of the other party during the term.
"""

def test_contract_analysis_text():
    report = ContractAnalyzer.analyze_text(SAMPLE_NDA_TEXT, page_count=2)
    assert report["is_analyzed"] is True
    assert "Non-Disclosure" in report["document_type"]
    assert report["key_commercial_terms"]["governing_law"] == "Delaware"
    assert "30 days" in report["key_commercial_terms"]["termination_notice"]
    assert "Net 30" in report["key_commercial_terms"]["payment_terms"]
    assert report["page_count"] == 2
    assert report["word_count"] > 50
    assert report["estimated_read_minutes"] >= 1
    
    # Check risk flags
    categories = [rf["category"] for rf in report["risk_flags"]]
    assert "Commitment Term" in categories
    assert "Liability & Exposure" in categories
    assert "Covenants" in categories
