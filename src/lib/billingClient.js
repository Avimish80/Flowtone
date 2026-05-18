import { flowtoneJson } from "@/lib/flowtoneApi";

export async function fetchAccessState(accessToken) {
  return flowtoneJson("/api/me/access", {
    accessToken,
  });
}

export async function createCheckoutSession(returnUrl = window.location.href) {
  return flowtoneJson("/api/billing/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({ returnUrl }),
  });
}

export async function createPortalSession(returnUrl = window.location.href) {
  return flowtoneJson("/api/billing/create-portal-session", {
    method: "POST",
    body: JSON.stringify({ returnUrl }),
  });
}
