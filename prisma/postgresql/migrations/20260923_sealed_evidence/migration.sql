-- Sealed evidence: seal v2 manifest (src/lib/seal.ts), RFC 3161 seal
-- timestamps (src/lib/tsa.ts), PAdES-signed PDFs (src/lib/signed-pdf.ts),
-- adopted signatures, server-held seal certificate keys and the contract
-- text of template envelopes as sent.
-- Generated with `prisma migrate diff`, plus the data fix at the end.

-- AlterTable
ALTER TABLE "Envelope" ADD COLUMN     "contractText" TEXT,
ADD COLUMN     "sealFormat" TEXT,
ADD COLUMN     "sealManifest" TEXT,
ADD COLUMN     "sealTimestamp" TEXT,
ADD COLUMN     "sealTimestampAt" TIMESTAMP(3),
ADD COLUMN     "sealTimestampTsa" TEXT,
ADD COLUMN     "signedPdfAt" TIMESTAMP(3),
ADD COLUMN     "signedPdfKey" TEXT,
ADD COLUMN     "signedPdfLevel" TEXT,
ADD COLUMN     "signedPdfSha256" TEXT,
ADD COLUMN     "signedPdfSigner" TEXT;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "signatureFont" TEXT,
ADD COLUMN     "signatureImage" TEXT,
ADD COLUMN     "signatureMethod" TEXT,
ADD COLUMN     "signatureSha256" TEXT;

-- AlterTable
ALTER TABLE "SigningCertificate" ADD COLUMN     "chainPem" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'issued',
ADD COLUMN     "privateKeyEnc" TEXT;

-- AlterTable
ALTER TABLE "TsaConfig" ALTER COLUMN "url" SET DEFAULT 'http://timestamp.digicert.com';

-- AlterTable
ALTER TABLE "PlatformSetting" ALTER COLUMN "tsaUrl" SET DEFAULT 'http://timestamp.digicert.com';

-- Data: DigiCert serves RFC 3161 over plain HTTP only; its HTTPS endpoint never
-- answers, so stored copies of the old default are moved to the working URL.
UPDATE "PlatformSetting" SET "tsaUrl" = 'http://timestamp.digicert.com' WHERE "tsaUrl" = 'https://timestamp.digicert.com';
UPDATE "TsaConfig" SET "url" = 'http://timestamp.digicert.com' WHERE "url" = 'https://timestamp.digicert.com';
