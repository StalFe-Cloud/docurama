-- No invented adoption evidence for historical signatures.
ALTER TABLE "Recipient" ADD COLUMN "signatureData" TEXT;
ALTER TABLE "Envelope" ADD COLUMN "evidenceSha256" TEXT;
