export const PREVIEW_USER = {
  id: "preview-user",
  email: "preview@flowtone.local",
  role: "preview",
  user_metadata: {
    full_name: "Flowtone Preview",
  },
};

export const PREVIEW_ACCESS_STATE = {
  user_id: PREVIEW_USER.id,
  email: PREVIEW_USER.email,
  has_access: true,
  subscription_status: "preview",
  plan_name: "Preview Mode",
  trial_ends_at: null,
  billing_customer_id: null,
};

