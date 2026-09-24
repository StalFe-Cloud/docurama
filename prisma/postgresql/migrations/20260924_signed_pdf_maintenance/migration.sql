-- Long-term maintenance of signed PDFs (src/lib/signed-pdf.ts): when to next
-- retry B-T/B-LT or renew the B-LTA archive timestamp, and the fingerprints of
-- earlier copies superseded by those incremental updates.
-- Generated with `prisma migrate diff`.

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "signedPdfCheckAt" TIMESTAMP(3),
ADD COLUMN     "signedPdfRevisions" TEXT;

-- CreateIndex
CREATE INDEX "Envelope_signedPdfCheckAt_idx" ON "Envelope"("signedPdfCheckAt");
