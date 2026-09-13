"""
Outbound email.

Docurama previously wrote audit events claiming invitations and reminders had been
sent while no mail code existed at all. Those events end up on the evidentiary
certificate, so the rule here is: this module reports precisely what happened, and
callers only write a "sent" audit event after a send is confirmed.

When SMTP is not configured, send attempts return sent=False with a reason rather
than raising. A missing mail server must not prevent an envelope from being created,
but it must never be recorded as a delivery either.

The mail server is configured in the product, not in the environment, so every send
takes the profile to use. services/smtp_config resolves it: the account's own profile
first, then the platform default. Passing it in rather than reading a global is what
allows one company to send from its own domain while another uses the platform's.
"""
import os
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Dict, List, Optional

from app.services.smtp_config import SmtpConfig

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class SendResult:
    """Outcome of a single message. `sent` is only True when the server accepted it."""
    recipient: str
    sent: bool
    message_id: Optional[str] = None
    error: Optional[str] = None

    def as_dict(self) -> Dict[str, Optional[str]]:
        return {
            "recipient": self.recipient,
            "sent": self.sent,
            "message_id": self.message_id,
            "error": self.error,
        }


@dataclass
class BatchResult:
    """Aggregate outcome, used to decide what the audit trail may claim."""
    results: List[SendResult] = field(default_factory=list)

    @property
    def sent_count(self) -> int:
        return sum(1 for r in self.results if r.sent)

    @property
    def failed_count(self) -> int:
        return sum(1 for r in self.results if not r.sent)

    @property
    def any_sent(self) -> bool:
        return self.sent_count > 0

    @property
    def all_sent(self) -> bool:
        return bool(self.results) and self.failed_count == 0

    def summary(self) -> str:
        if not self.results:
            return "No recipients to notify."
        if self.all_sent:
            return f"Delivered to {self.sent_count} recipient(s)."
        if self.any_sent:
            return f"Delivered to {self.sent_count} of {len(self.results)} recipient(s)."
        first_error = next((r.error for r in self.results if r.error), "unknown error")
        return f"Delivery failed for all {len(self.results)} recipient(s): {first_error}"


def is_configured(config: Optional[SmtpConfig]) -> bool:
    """A profile is usable only when it names a server and a sender."""
    return bool(config and config.is_usable)


def _valid_address(address: str) -> bool:
    return bool(address and _EMAIL_RE.match(address.strip()))


def _build_message(
    config: SmtpConfig, to_address: str, to_name: str, subject: str,
    html_body: str, text_body: str,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((config.from_name or "Docurama", config.from_email))
    msg["To"] = formataddr((to_name or to_address, to_address))
    msg["Message-ID"] = make_msgid(domain=config.from_email.split("@")[-1])
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    return msg


def _attach_files(msg: EmailMessage, attachments: Optional[List[str]]) -> None:
    for path in attachments or []:
        if not path or not os.path.exists(path):
            continue
        try:
            with open(path, "rb") as f:
                data = f.read()
            msg.add_attachment(
                data,
                maintype="application",
                subtype="pdf",
                filename=os.path.basename(path),
            )
        except Exception as e:
            print(f"[Mailer] Could not attach {path}: {e}")


def _connect(config: SmtpConfig):
    """Open an SMTP connection honouring the profile's transport security."""
    if config.use_ssl:
        context = ssl.create_default_context()
        server = smtplib.SMTP_SSL(config.host, config.port, timeout=config.timeout, context=context)
    else:
        server = smtplib.SMTP(config.host, config.port, timeout=config.timeout)
        if config.use_tls:
            server.starttls(context=ssl.create_default_context())

    if config.username:
        server.login(config.username, config.password)
    return server


def send_email(
    config: Optional[SmtpConfig],
    to_address: str,
    to_name: str,
    subject: str,
    html_body: str,
    text_body: str,
    attachments: Optional[List[str]] = None,
) -> SendResult:
    """Send one message. Never raises; failures come back as sent=False."""
    address = (to_address or "").strip()

    if not _valid_address(address):
        return SendResult(address, False, error="Recipient address is missing or malformed.")

    if not is_configured(config):
        return SendResult(
            address,
            False,
            error=(
                "No mail server is configured. Set one under Settings, Notifications, "
                "Email Delivery, or ask a platform administrator to configure the default."
            ),
        )

    try:
        msg = _build_message(config, address, to_name, subject, html_body, text_body)
        _attach_files(msg, attachments)
        with _connect(config) as server:
            server.send_message(msg)
        return SendResult(address, True, message_id=msg["Message-ID"])
    except Exception as e:
        return SendResult(address, False, error=f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _shell(title: str, intro: str, body_html: str, cta_url: Optional[str], cta_label: Optional[str]) -> str:
    button = ""
    if cta_url and cta_label:
        button = (
            f'<p style="margin:28px 0;">'
            f'<a href="{cta_url}" style="background:#1D72FE;color:#ffffff;text-decoration:none;'
            f'padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">{cta_label}</a>'
            f"</p>"
            f'<p style="font-size:12px;color:#64748b;">Or paste this link into your browser:<br>'
            f'<span style="word-break:break-all;">{cta_url}</span></p>'
        )
    return f"""<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;">
  <h1 style="font-size:18px;margin:0 0 8px;">{title}</h1>
  <p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 16px;">{intro}</p>
  {body_html}
  {button}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 14px;">
  <p style="font-size:11px;color:#94a3b8;margin:0;">
    Sent by Docurama. If you were not expecting this message you can safely ignore it.
  </p>
</div>
</body></html>"""


def signing_invitation(recipient_name: str, envelope_title: str, signing_url: str, sender_name: str):
    subject = f"Signature requested: {envelope_title}"
    intro = (
        f"{sender_name} has sent you <strong>{envelope_title}</strong> to review and sign."
    )
    html = _shell(
        "You have a document to sign",
        intro,
        '<p style="font-size:13px;color:#475569;">The link below is unique to you. Please do not forward it.</p>',
        signing_url,
        "Review & Sign",
    )
    text = (
        f"{sender_name} has sent you '{envelope_title}' to review and sign.\n\n"
        f"Open your personal signing link:\n{signing_url}\n\n"
        "This link is unique to you. Please do not forward it.\n"
    )
    return subject, html, text


def signing_reminder(recipient_name: str, envelope_title: str, signing_url: str, reminder_number: int):
    subject = f"Reminder: {envelope_title} is waiting for your signature"
    intro = (
        f"This is a reminder that <strong>{envelope_title}</strong> is still awaiting your signature."
    )
    html = _shell(
        "A document is waiting for you",
        intro,
        f'<p style="font-size:13px;color:#475569;">Reminder {reminder_number}.</p>',
        signing_url,
        "Review & Sign",
    )
    text = (
        f"Reminder {reminder_number}: '{envelope_title}' is still awaiting your signature.\n\n"
        f"{signing_url}\n"
    )
    return subject, html, text


def signer_otp(recipient_name: str, envelope_title: str, otp_code: str):
    subject = f"Your verification code: {otp_code} for {envelope_title}"
    intro = (
        f"Hello {recipient_name},<br/><br/>"
        f"You have requested access to sign <strong>{envelope_title}</strong>. "
        f"Use the following one-time verification code to verify your identity:"
    )
    code_block = (
        f'<div style="text-align:center;margin:24px 0;">'
        f'<span style="display:inline-block;font-size:32px;font-weight:bold;letter-spacing:6px;'
        f'color:#0f172a;background:#f1f5f9;padding:12px 24px;border-radius:8px;border:1px solid #cbd5e1;">'
        f'{otp_code}'
        f'</span>'
        f'</div>'
        f'<p style="font-size:12px;color:#64748b;text-align:center;">This code expires in 10 minutes. '
        f'If you did not request this code, you can safely ignore this email.</p>'
    )
    html = _shell(
        "Signer Identity Verification",
        intro,
        code_block,
        None,
        None,
    )
    text = (
        f"Hello {recipient_name},\n\n"
        f"Your verification code for '{envelope_title}' is: {otp_code}\n\n"
        f"This code expires in 10 minutes. If you did not request this code, you can safely ignore this email.\n"
    )
    return subject, html, text



def completion_notice(recipient_name: str, envelope_title: str, verify_url: str, sealed: bool):
    subject = f"Completed: {envelope_title}"
    if sealed:
        seal_line = (
            '<p style="font-size:13px;color:#475569;">The completed document is attached, '
            "sealed and timestamped. You can confirm it independently at the link below.</p>"
        )
    else:
        # Never imply a seal that was not applied.
        seal_line = (
            '<p style="font-size:13px;color:#b45309;">The completed document is attached. '
            "A cryptographic seal was not applied to this document; its audit trail remains "
            "on record and can be checked at the link below.</p>"
        )
    html = _shell(
        "All parties have signed",
        f"<strong>{envelope_title}</strong> has been completed by all recipients.",
        seal_line,
        verify_url,
        "Verify this document",
    )
    text = (
        f"'{envelope_title}' has been completed by all recipients.\n\n"
        + (
            "The attached document is sealed and timestamped.\n"
            if sealed
            else "A cryptographic seal was not applied to the attached document.\n"
        )
        + f"\nVerify: {verify_url}\n"
    )
    return subject, html, text


def decline_notice(recipient_name: str, envelope_title: str, decliner_name: str, reason: str):
    subject = f"Declined: {envelope_title}"
    html = _shell(
        "A recipient declined to sign",
        f"<strong>{decliner_name}</strong> declined to sign <strong>{envelope_title}</strong>.",
        f'<p style="font-size:13px;color:#475569;">Reason given: {reason or "No reason provided."}</p>',
        None,
        None,
    )
    text = (
        f"{decliner_name} declined to sign '{envelope_title}'.\n\n"
        f"Reason: {reason or 'No reason provided.'}\n"
    )
    return subject, html, text


def password_reset(recipient_name: str, reset_link: str, ttl_minutes: int):
    """
    A password reset link.

    States the expiry, and that an unrequested mail can be ignored: the request
    endpoint deliberately answers the same for unknown addresses, so one of these can
    legitimately reach someone who did not ask for it.
    """
    subject = "Reset your Docurama password"
    intro = "We received a request to reset the password on your Docurama account."
    html = _shell(
        "Reset your password",
        intro,
        f'<p style="font-size:13px;color:#475569;">This link works once and expires in '
        f'{ttl_minutes} minutes. If you did not request it, no action is needed and your '
        f'password stays as it is.</p>',
        reset_link,
        "Choose a new password",
    )
    text = (
        "We received a request to reset the password on your Docurama account.\n\n"
        f"{reset_link}\n\n"
        f"This link works once and expires in {ttl_minutes} minutes. "
        "If you did not request it, no action is needed.\n"
    )
    return subject, html, text


def team_invite(recipient_name: str, company_name: str, invite_link: str,
                sender_name: str, role: str):
    """
    An invitation to join a company.

    Carries a single-use set-password link rather than a password: the recipient
    chooses their own credential, and the link expires like a reset link because
    it is one.
    """
    subject = f"You have been invited to {company_name} on Docurama"
    intro = f"Hi {recipient_name or 'there'},"
    body_html = (
        f"<p>{sender_name} has invited you to join <strong>{company_name}</strong> "
        f"as {role}.</p>"
        "<p>Choose your own password to activate your account. The link works once "
        "and expires in 60 minutes.</p>"
    )
    html = _shell(
        "You have been invited",
        intro,
        body_html,
        invite_link,
        "Set your password",
    )
    text = (
        f"{sender_name} has invited you to join {company_name} as {role}.\n\n"
        "Choose your own password to activate your account. The link works once "
        f"and expires in 60 minutes.\n\n{invite_link}\n"
    )
    return subject, html, text


def password_changed_notice(recipient_name: str, when_utc: str):
    """
    Tell someone their password changed, after the fact.

    A change the account holder did not make should be visible to them rather than
    silent. This is the message that surfaces a compromise.
    """
    subject = "Your Docurama password was changed"
    html = _shell(
        "Your password was changed",
        f"The password on your Docurama account was changed on {when_utc}.",
        '<p style="font-size:13px;color:#b45309;">If this was not you, reset your password '
        'immediately and review who has access to your account.</p>',
        None,
        None,
    )
    text = (
        f"The password on your Docurama account was changed on {when_utc}.\n\n"
        "If this was not you, reset your password immediately.\n"
    )
    return subject, html, text


def smtp_test_message(from_email: str, source: str):
    """
    Confirmation that a mail profile works, sent from the settings screen.

    Names the profile that carried it, so an operator can tell whether their own
    configuration is in use or they are falling back to the platform default.
    """
    subject = "Docurama mail server test"
    profile = "this company's own mail server" if source == "account" else "the platform default mail server"
    html = _shell(
        "Mail delivery is working",
        f"This test message was sent through <strong>{profile}</strong> ({from_email}).",
        '<p style="font-size:13px;color:#475569;">Signature requests, reminders and '
        'completion notices will be delivered this way.</p>',
        None,
        None,
    )
    text = (
        f"This test message was sent through {profile} ({from_email}).\n\n"
        "Signature requests, reminders and completion notices will be delivered this way.\n"
    )
    return subject, html, text
