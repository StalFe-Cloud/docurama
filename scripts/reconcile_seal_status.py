"""
Establish the true seal state of documents completed before seal tracking existed.

Those envelopes carry seal_status='pending', which means unknown rather than sealed.
They were produced by code that reported every signing attempt as successful even when
it had copied the file unchanged, so their recorded state says nothing about what is
actually in the PDF. They were deliberately not backfilled: asserting a seal that was
never verified is the defect this release exists to remove.

This inspects each stored document and records what is observed, which is the same
principle applied retrospectively.

Rules:
  * a real signature in the file      -> sealed
  * no signature, or an invalid one   -> unsealed
  * the file is missing               -> left alone and reported

Only completed envelopes are considered. One still awaiting a signature has not reached
the sealing step, so its unknown state is correct.

A missing file is not evidence that no seal existed, so those rows keep their unknown
state rather than being marked unsealed.

Run inside the API container, where pyHanko is installed:

    docker compose exec docurama-api python /app/reconcile_seal_status.py
    docker compose exec docurama-api python /app/reconcile_seal_status.py --apply

Dry run by default.
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, "/app")
os.environ.setdefault("DOCURAMA_ENV", "development")

from sqlalchemy.future import select  # noqa: E402

from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import Envelope  # noqa: E402
from app.services.crypto_engine import verify_document_integrity  # noqa: E402


async def reconcile(apply_changes: bool) -> int:
    sealed = unsealed = missing = 0

    async with AsyncSessionLocal() as session:
        # Only completed envelopes. One still awaiting a signature has not reached the
        # sealing step, so "pending" is the correct state for it and marking it unsealed
        # would be its own false claim.
        envelopes = (await session.execute(
            select(Envelope)
            .where(
                Envelope.seal_status == "pending",
                Envelope.status == "completed",
            )
            .order_by(Envelope.created_at.asc())
        )).scalars().all()

        if not envelopes:
            print("No completed envelopes are awaiting reconciliation.")
            return 0

        print(f"{len(envelopes)} envelope(s) with an unknown seal state.\n")

        for env in envelopes:
            path = env.signed_pdf_path or env.original_pdf_path
            label = f"{(env.title or 'Untitled')[:44]:46}"

            if not path or not os.path.exists(path):
                missing += 1
                print(f"  {label} file missing, left unknown  ({path or 'no path recorded'})")
                continue

            # The same inspection the verification portal performs, so the recorded
            # state and what a counterparty sees cannot disagree.
            observed = await asyncio.to_thread(verify_document_integrity, path)
            has_signature = bool(observed.get("has_digital_signature"))
            is_valid = bool(observed.get("is_valid"))

            status = "sealed" if (has_signature and is_valid) else "unsealed"
            level = observed.get("pades_level")

            if status == "sealed":
                sealed += 1
                print(f"  {label} sealed   ({level or 'level not established'})")
            else:
                unsealed += 1
                print(f"  {label} unsealed ({observed.get('message', '')[:60]})")

            if apply_changes:
                details = dict(env.seal_details or {})
                details.update({
                    "sealed": status == "sealed",
                    "pades_level": level,
                    "subject": observed.get("signer_subject"),
                    "issuer": observed.get("signer_issuer"),
                    "timestamp_utc": observed.get("timestamp_utc"),
                    # Recorded so the provenance of this value is never ambiguous: it
                    # was established by inspecting the file later, not at completion.
                    "established_by": "retrospective audit",
                    "audited_at": datetime.now(timezone.utc).isoformat(),
                })
                env.seal_status = status
                env.seal_details = details

        if apply_changes:
            await session.commit()

    print()
    print(f"  sealed:   {sealed}")
    print(f"  unsealed: {unsealed}")
    print(f"  unknown:  {missing} (file missing)")
    print()
    if apply_changes:
        print("Applied. The verification portal now reports the observed state.")
    else:
        print("Dry run. Re-run with --apply to write these results.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record the observed seal state of envelopes completed before seal tracking."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the results. Without this the script only reports.",
    )
    args = parser.parse_args()
    return asyncio.run(reconcile(args.apply))


if __name__ == "__main__":
    sys.exit(main())
