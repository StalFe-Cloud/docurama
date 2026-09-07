# Cryptographic Digital Signing Certificates

For PAdES-LTV digital signing and RFC 3161 timestamping, place your PKCS#12 signing certificate here:

- `docurama_document_signing_cert.p12` (or your custom `.p12` bundle)
- Configure the passphrase via the `CERT_PASSWORD` environment variable in `.env`.

> [!CAUTION]
> Never commit `.p12`, `.pem`, or private keys to source control. They are strictly ignored by `.gitignore`.
