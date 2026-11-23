// One place that answers "can Flowtone send email, and from where?", so the
// invoice, quote and follow-up screens do not care which account is linked.
// Gmail (OAuth, tokens on this device) wins when both are connected because
// it was there first; iCloud Mail (server-side IMAP/SMTP) is the alternative.
import { isGmailConnected, getGmailEmail, sendGmailEmail } from "@/lib/gmailClient";
import {
  isICloudMailConnected, getICloudMailEmail, sendICloudMail, refreshICloudMailStatus,
} from "@/lib/icloudMailClient";

export function getMailProvider() {
  if (isGmailConnected()) return "gmail";
  if (isICloudMailConnected()) return "icloud";
  return null;
}

export function isMailConnected() {
  return getMailProvider() !== null;
}

export function getMailProviderLabel() {
  const provider = getMailProvider();
  if (provider === "gmail") return "Gmail";
  if (provider === "icloud") return "iCloud Mail";
  return "";
}

export function getSenderEmail() {
  const provider = getMailProvider();
  if (provider === "gmail") return getGmailEmail();
  if (provider === "icloud") return getICloudMailEmail();
  return "";
}

/** Send through whichever account is connected. Throws when none is. */
export async function sendEmail({ to, subject, htmlBody, text, cc, replyTo }) {
  const provider = getMailProvider();
  if (provider === "gmail") return sendGmailEmail({ to, subject, htmlBody });
  if (provider === "icloud") return sendICloudMail({ to, cc, subject, htmlBody, text, replyTo });
  throw new Error("No email account connected");
}

/** Refresh the cached iCloud state; called on app open. Fail-quiet. */
export const refreshMailStatus = refreshICloudMailStatus;
