import { Router } from "express";
import Stripe from "stripe";
import { requireAuthenticatedUser } from "../lib/auth.js";
import {
  ensureProfileForUser,
  updateProfileByCustomerId,
  updateProfileById,
} from "../lib/access.js";

const router = Router();

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
const stripePriceId = process.env.STRIPE_PRICE_ID?.trim();
const defaultPlanName = process.env.STRIPE_PLAN_NAME?.trim() || "Flowtone Paid Beta";

let stripeClient = null;

function getStripe() {
  if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY must be configured.");
  if (!stripeClient) stripeClient = new Stripe(stripeSecretKey);
  return stripeClient;
}

async function ensureStripeCustomer(profile, user) {
  if (profile?.billing_customer_id) return profile.billing_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: profile?.full_name || undefined,
    metadata: {
      supabase_user_id: user.id,
    },
  });

  await updateProfileById(user.id, {
    billing_customer_id: customer.id,
  });

  return customer.id;
}

router.post("/create-checkout-session", requireAuthenticatedUser, async (req, res) => {
  try {
    if (!stripePriceId) {
      return res.status(500).json({ error: "STRIPE_PRICE_ID must be configured." });
    }

    const stripe = getStripe();
    const profile = await ensureProfileForUser(req.flowtoneUser);
    const customerId = await ensureStripeCustomer(profile, req.flowtoneUser);
    const returnUrl = req.body?.returnUrl || process.env.APP_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      allow_promotion_codes: true,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      metadata: {
        supabase_user_id: req.flowtoneUser.id,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: req.flowtoneUser.id,
        },
      },
      success_url: `${returnUrl.split("?")[0]}?checkout=success`,
      cancel_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not create checkout session" });
  }
});

router.post("/create-portal-session", requireAuthenticatedUser, async (req, res) => {
  try {
    const stripe = getStripe();
    const profile = await ensureProfileForUser(req.flowtoneUser);

    if (!profile?.billing_customer_id) {
      return res.status(400).json({ error: "No billing customer found for this account." });
    }

    const returnUrl = req.body?.returnUrl || process.env.APP_URL || "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.billing_customer_id,
      return_url: returnUrl,
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not open billing portal" });
  }
});

export async function handleStripeWebhook(req, res) {
  try {
    if (!stripeWebhookSecret) {
      return res.status(500).send("STRIPE_WEBHOOK_SECRET must be configured.");
    }

    const stripe = getStripe();
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).send("Missing Stripe signature.");
    }

    const event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (userId) {
          await updateProfileById(userId, {
            billing_customer_id: session.customer,
            subscription_status: "active",
            plan_name: defaultPlanName,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const trialEndsAt = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null;

        await updateProfileByCustomerId(subscription.customer, {
          subscription_status: subscription.status,
          plan_name: defaultPlanName,
          trial_ends_at: trialEndsAt,
        });
        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (error) {
    return res.status(400).send(`Webhook error: ${error.message || "Unknown error"}`);
  }
}

export default router;
