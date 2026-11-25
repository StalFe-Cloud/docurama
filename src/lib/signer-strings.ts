/**
 * Signer-portal UI strings — the /sign/{token} face of Docurama.
 *
 * Invitations and OTP codes are already localized per recipient
 * (src/lib/signing-email.ts, src/lib/sms.ts) using recipient.locale; the
 * signing page used to be English-only, so a French recipient landed on an
 * English form straight after a French email. This module gives the portal
 * the same two languages, resolved server-side from the same recipient
 * record — no routing, no cookies, deterministic per link — plus a client
 * toggle that persists the choice back onto the recipient (op "set-locale")
 * so later reminder emails match the language the signer actually used.
 *
 * Keeping this as a dedicated module (instead of messages/{en,fr}.json) is
 * deliberate: the signer portal must never depend on the marketing i18n
 * routing stack — the token is the only context a public link has.
 */

export type SignerLocale = "en" | "fr";

/** Same normalization as the email pipeline: any fr* locale is French. */
export function normalizeSignerLocale(raw: string | null | undefined): SignerLocale {
  return typeof raw === "string" && /^fr(?:-|$)/i.test(raw.trim()) ? "fr" : "en";
}

export type SignerStrings = {
  // Header / footer
  secureSigning: string;
  residency: string;
  verifyAnother: string;
  language: string;
  // Download strip (sealed / completed)
  downloadCompleted: string;
  downloadRecord: string;
  // Invalid / unavailable
  invalidTitle: string;
  invalidBody: string;
  unavailableTitle: string;
  // Terminal states
  terminalTitle: string;
  terminalStatus: string;
  terminalVoidReason: string;
  expiredBody: string;
  declinedTitle: string;
  declinedBody: string;
  // CC recipient
  ccTitle: string;
  ccBody: string;
  ccBodySuffix: string;
  ccBodySuffix2: string;
  // Signed confirmation
  signedTitle: string;
  signedBodySealed: string;
  signedBodyPending: string;
  sealedCardTitle: string;
  sealedCardBody: string;
  sealedCardBody2: string;
  verifySeal: string;
  // Completed (late visitor)
  completedTitle: string;
  completedBody: string;
  openVerify: string;
  // Waiting for turn
  waitTitle: string;
  waitBody: string;
  waitBodySuffix: string;
  // Signing deadline (cycle 12)
  deadlineNotice: string;
  // Verification gate (OTP / account)
  verifyTitle: string;
  verifyBody: string;
  verifyBodySuffix: string;
  continueAs: string;
  orCode: string;
  emailChannel: string;
  smsChannel: string;
  phoneLabel: string;
  phonePlaceholder: string;
  emailCodeTo: string;
  smsMe: string;
  codeSentTo: string;
  verifyContinue: string;
  verifying: string;
  resend: string;
  resendIn: string;
  // Active signing
  forSignature: string;
  sentBy: string;
  pageOne: string;
  pageMany: string;
  senderDomainVerified: string;
  messageLabel: string;
  integrityVerified: string;
  signersLabel: string;
  statusSigned: string;
  statusSigningNow: string;
  statusPending: string;
  // Document preview
  docPreview: string;
  fieldHint: string;
  pageOf: string;
  renderingPage: string;
  previewError: string;
  previousPage: string;
  nextPage: string;
  // Zoom
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  zoomLabel: string;
  // Contract text card
  documentText: string;
  // Field inputs
  fieldOnPage: string;
  // Fine print
  finePrint: string;
  // Adopt signature
  adoptTitle: string;
  fullName: string;
  fullNamePlaceholder: string;
  signatureStyle: string;
  yourNamePreview: string;
  yourSignaturePreview: string;
  signedOnNote: string;
  typedBadge: string;
  modeType: string;
  modeDraw: string;
  drawHint: string;
  clearDrawing: string;
  drawnBadge: string;
  // Consent
  consentVersion: string;
  // Actions
  signDocument: string;
  signing: string;
  declineToSign: string;
  declineDialogTitle: string;
  declineDialogBody: string;
  declineReasonLabel: string;
  declineReasonPlaceholder: string;
  cancel: string;
  confirmDecline: string;
  // Client-side validation errors
  errorNameRequired: string;
  errorConsentRequired: string;
  errorDrawEmpty: string;
};

export const SIGNER_STRINGS: Record<SignerLocale, SignerStrings> = {
  en: {
    secureSigning: "Secure signing",
    residency: "VOIRIA SASU (Docurama) · Paris, France · EU data residency",
    verifyAnother: "Verify another document",
    language: "Language",
    downloadCompleted: "Download completed PDF",
    downloadRecord: "Download completion record PDF",
    invalidTitle: "This signing link is not valid",
    invalidBody:
      "The link may have been mistyped, or the invitation was voided by the sender. Please use the exact link from your invitation email.",
    unavailableTitle: "Signing is unavailable",
    terminalTitle: "This document is no longer available for signing",
    terminalStatus: "Status",
    terminalVoidReason: "Reason",
    expiredBody: "The signing deadline set by the sender has passed. If your signature is still needed, ask the sender to send a new request.",
    declinedTitle: "You declined to sign",
    declinedBody: "The sender has been notified that you declined",
    ccTitle: "You receive a copy of this document",
    ccBody: "you are in copy of",
    ccBodySuffix: "sent by",
    ccBodySuffix2: "You will get the completed document once every signer has signed.",
    signedTitle: "Document signed",
    signedBodySealed: "All parties have signed — the envelope is sealed and verifiable.",
    signedBodyPending: "Other signers are still pending; you will receive the completed document once everyone has signed.",
    sealedCardTitle: "Envelope sealed",
    sealedCardBody: "Verification code",
    sealedCardBody2: "— anyone can confirm the seal on the public portal, no account needed.",
    verifySeal: "Verify the seal",
    completedTitle: "This document is fully signed",
    completedBody: "was completed and sealed. Verify it with code",
    openVerify: "Open the verification portal",
    waitTitle: "It is not your turn to sign yet",
    waitBody: "signs before you on",
    waitBodySuffix: "Keep this link — it becomes active as soon as they have signed.",
    deadlineNotice: "This document must be signed by",
    verifyTitle: "Verify it's you",
    verifyBody: "the sender requires identity verification before you sign",
    verifyBodySuffix: "No account is needed.",
    continueAs: "Continue as",
    orCode: "— or verify with a one-time code below —",
    emailChannel: "Email code",
    smsChannel: "SMS code",
    phoneLabel: "Phone number (international format)",
    phonePlaceholder: "+33612345678",
    emailCodeTo: "Email a code to",
    smsMe: "SMS me a code",
    codeSentTo: "Code sent to",
    verifyContinue: "Verify and continue",
    verifying: "Verifying…",
    resend: "Resend code",
    resendIn: "Resend available in",
    forSignature: "Document for your signature",
    sentBy: "Sent by",
    pageOne: "page",
    pageMany: "pages",
    senderDomainVerified: "Sender domain verified via DNS TXT:",
    messageLabel: "Message from the sender",
    integrityVerified: "Integrity verified",
    signersLabel: "Signers",
    statusSigned: "Signed",
    statusSigningNow: "Signing now",
    statusPending: "Pending",
    docPreview: "Document preview",
    fieldHint:
      "Highlighted positions show where each signer's recorded values appear in the completed PDF. The original uploaded PDF remains unchanged.",
    pageOf: "Page {page} of {pages}",
    renderingPage: "Rendering page",
    previewError:
      "This page could not be rendered. You can still review the document details above and sign — the file integrity is independently verified by its SHA-256 digest.",
    previousPage: "Previous page",
    nextPage: "Next page",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Reset zoom",
    zoomLabel: "Zoom",
    documentText: "Document text",
    fieldOnPage: "page",
    finePrint:
      "The completed PDF records typed signatures in standard italic text; drawn signatures are embedded as the image you drew. Positioned fields support unrotated, uncropped pages and Western text; dates are calendar dates without a time zone.",
    adoptTitle: "Adopt your signature",
    fullName: "Your full name",
    fullNamePlaceholder: "Type your full name",
    signatureStyle: "Signature style",
    yourNamePreview: "Your name",
    yourSignaturePreview: "Your signature",
    signedOnNote: "Signed on the date shown in the audit record",
    typedBadge: "Email-link typed signature · audit-trailed",
    modeType: "Type",
    modeDraw: "Draw",
    drawHint: "Draw your signature above with a finger, stylus or mouse.",
    clearDrawing: "Clear",
    drawnBadge: "Email-link drawn signature · audit-trailed",
    consentVersion: "Consent version:",
    signDocument: "Sign document",
    signing: "Signing…",
    declineToSign: "Decline to sign",
    declineDialogTitle: "Decline to sign this document?",
    declineDialogBody: "The sender will be notified that you declined. You can add an optional reason.",
    declineReasonLabel: "Reason (optional)",
    declineReasonPlaceholder: "e.g. wrong-terms-need-revision",
    cancel: "Cancel",
    confirmDecline: "Confirm decline",
    errorNameRequired: "Please type your full name to sign.",
    errorConsentRequired: "Please confirm you have read and agree to sign electronically.",
    errorDrawEmpty: "Draw your signature in the box, or switch to typing your name.",
  },
  fr: {
    secureSigning: "Signature sécurisée",
    residency: "VOIRIA SASU (Docurama) · Paris, France · hébergement dans l'UE",
    verifyAnother: "Vérifier un autre document",
    language: "Langue",
    downloadCompleted: "Télécharger le PDF signé",
    downloadRecord: "Télécharger le procès-verbal d'achèvement",
    invalidTitle: "Ce lien de signature n'est pas valide",
    invalidBody:
      "Le lien a peut-être été mal recopié, ou l'invitation a été annulée par l'expéditeur. Utilisez le lien exact figurant dans votre e-mail d'invitation.",
    unavailableTitle: "La signature est indisponible",
    terminalTitle: "Ce document n'est plus disponible à la signature",
    terminalStatus: "Statut",
    terminalVoidReason: "Motif",
    expiredBody: "La date limite de signature fixée par l'expéditeur est dépassée. Si votre signature est toujours nécessaire, demandez à l'expéditeur d'envoyer une nouvelle demande.",
    declinedTitle: "Vous avez refusé de signer",
    declinedBody: "L'expéditeur a été informé que vous avez refusé de signer",
    ccTitle: "Vous recevez une copie de ce document",
    ccBody: "vous recevez une copie de",
    ccBodySuffix: "envoyé par",
    ccBodySuffix2: "Vous recevrez le document final dès que tous les signataires auront signé.",
    signedTitle: "Document signé",
    signedBodySealed: "Toutes les parties ont signé — l'enveloppe est scellée et vérifiable.",
    signedBodyPending: "D'autres signataires sont attendus ; vous recevrez le document final dès que tous auront signé.",
    sealedCardTitle: "Enveloppe scellée",
    sealedCardBody: "Code de vérification",
    sealedCardBody2: "— n'importe qui peut confirmer le scellé sur le portail public, sans compte.",
    verifySeal: "Vérifier le scellé",
    completedTitle: "Ce document est entièrement signé",
    completedBody: "a été finalisé et scellé. Vérifiez-le avec le code",
    openVerify: "Ouvrir le portail de vérification",
    waitTitle: "Ce n'est pas encore votre tour de signer",
    waitBody: "signe avant vous sur",
    waitBodySuffix: "Conservez ce lien — il devient actif dès que sa signature est enregistrée.",
    deadlineNotice: "Ce document doit être signé avant le",
    verifyTitle: "Vérifiez votre identité",
    verifyBody: "l'expéditeur exige une vérification d'identité avant de signer",
    verifyBodySuffix: "Aucun compte n'est nécessaire.",
    continueAs: "Continuer en tant que",
    orCode: "— ou vérifiez avec un code à usage unique ci-dessous —",
    emailChannel: "Code par e-mail",
    smsChannel: "Code par SMS",
    phoneLabel: "Numéro de téléphone (format international)",
    phonePlaceholder: "+33612345678",
    emailCodeTo: "Recevoir un code par e-mail à",
    smsMe: "Recevoir un code par SMS",
    codeSentTo: "Code envoyé à",
    verifyContinue: "Vérifier et continuer",
    verifying: "Vérification…",
    resend: "Renvoyer le code",
    resendIn: "Renvoi possible dans",
    forSignature: "Document à signer",
    sentBy: "Envoyé par",
    pageOne: "page",
    pageMany: "pages",
    senderDomainVerified: "Domaine de l'expéditeur vérifié par DNS TXT :",
    messageLabel: "Message de l'expéditeur",
    integrityVerified: "Intégrité vérifiée",
    signersLabel: "Signataires",
    statusSigned: "A signé",
    statusSigningNow: "Signature en cours",
    statusPending: "En attente",
    docPreview: "Aperçu du document",
    fieldHint:
      "Les positions surlignées indiquent où les valeurs enregistrées de chaque signataire apparaîtront dans le PDF final. Le PDF original reste inchangé.",
    pageOf: "Page {page} sur {pages}",
    renderingPage: "Rendu de la page",
    previewError:
      "Cette page n'a pas pu être affichée. Vous pouvez toujours consulter les détails du document ci-dessus et signer — l'intégrité du fichier est vérifiée indépendamment par son empreinte SHA-256.",
    previousPage: "Page précédente",
    nextPage: "Page suivante",
    zoomIn: "Zoom avant",
    zoomOut: "Zoom arrière",
    zoomReset: "Réinitialiser le zoom",
    zoomLabel: "Zoom",
    documentText: "Texte du document",
    fieldOnPage: "page",
    finePrint:
      "Le PDF final restitue les signatures saisies en italique standard ; les signatures dessinées sont intégrées telles quelles en image. Les champs positionnés prennent en charge les pages non pivotées et non recadrées et le texte occidental ; les dates sont des dates civiles sans fuseau horaire.",
    adoptTitle: "Adoptez votre signature",
    fullName: "Votre nom complet",
    fullNamePlaceholder: "Saisissez votre nom complet",
    signatureStyle: "Style de signature",
    yourNamePreview: "Votre nom",
    yourSignaturePreview: "Votre signature",
    signedOnNote: "Signé à la date indiquée dans le dossier d'audit",
    typedBadge: "Signature saisie par lien e-mail · avec piste d'audit",
    modeType: "Saisir",
    modeDraw: "Dessiner",
    drawHint: "Dessinez votre signature ci-dessus avec le doigt, un stylet ou la souris.",
    clearDrawing: "Effacer",
    drawnBadge: "Signature dessinée par lien e-mail · avec piste d'audit",
    consentVersion: "Version du consentement :",
    signDocument: "Signer le document",
    signing: "Signature…",
    declineToSign: "Refuser de signer",
    declineDialogTitle: "Refuser de signer ce document ?",
    declineDialogBody: "L'expéditeur sera informé de votre refus. Vous pouvez ajouter un motif facultatif.",
    declineReasonLabel: "Motif (facultatif)",
    declineReasonPlaceholder: "ex. conditions-a-revoir",
    cancel: "Annuler",
    confirmDecline: "Confirmer le refus",
    errorNameRequired: "Saisissez votre nom complet pour signer.",
    errorConsentRequired: "Confirmez avoir lu et accepté de signer par voie électronique.",
    errorDrawEmpty: "Dessinez votre signature dans le cadre, ou passez à la saisie de votre nom.",
  },
};

/** Render "Page {page} of {pages}" (en) / "Page {page} sur {pages}" (fr). */
export function formatPageLabel(strings: SignerStrings, page: number, pages: number): string {
  return strings.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages));
}
