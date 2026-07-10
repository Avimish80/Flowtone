// Public (unauthenticated) endpoints for the leads feature.
// Prospects hit these from /p/<slug> (enquiry page) and /q/<token> (quote page).
// All database access goes through the service-role admin client; every
// response is an explicit whitelist of fields — never spread DB rows.

import { Router } from 'express';
import webpush from 'web-push';
import { getSupabaseAdmin, isSupabaseServerConfigured } from '../lib/supabaseAdmin.js';
import { getSubscriptionsByUserId, deleteSubscription } from '../db.js';

const router = Router();

// ─── Rate limiting (in-memory, per-IP, POSTs only) ──────────────────
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_POSTS = 10;
const rateHits = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_POSTS) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (rateHits.size > 5000) {
    for (const [key, arr] of rateHits) {
      if (!arr.some((t) => now - t < RATE_WINDOW_MS)) rateHits.delete(key);
    }
  }
  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────
const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? null : value;
}

function guardConfigured(res) {
  if (!isSupabaseServerConfigured()) {
    res.status(503).json({ error: 'Service temporarily unavailable' });
    return false;
  }
  return true;
}

async function findProfileBySlug(slug) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('business_profiles')
    .select('user_id, business_name, logo, logo_url, enquiry_headline, enquiry_intro')
    .eq('public_slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function publicBusiness(profile) {
  return {
    business_name: profile?.business_name || '',
    logo_url: profile?.logo_url || profile?.logo || '',
    enquiry_headline: profile?.enquiry_headline || '',
    enquiry_intro: profile?.enquiry_intro || '',
  };
}

// Send a push to every device the user has registered, and write an in-app
// notification row. Both are best-effort — a lead must never be lost because
// a notification failed.
async function notifyUser(userId, { type, title, body, url, tag }) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      body: body || '',
      entity_type: 'lead',
      url: url || '/Leads',
    });
  } catch (err) {
    console.error('[public/notify] notification insert failed:', err.message);
  }

  for (const sub of getSubscriptionsByUserId(userId)) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body: body || '', url: url || '/Leads', tag: tag || `lead-${Date.now()}`, icon: '/icon-192x192.svg' })
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) deleteSubscription(sub.endpoint);
      else console.error('[public/notify] push failed:', err.message);
    }
  }
}

// ─── GET /api/public/enquiry/:slug ───────────────────────────────────
router.get('/enquiry/:slug', async (req, res) => {
  if (!guardConfigured(res)) return;
  try {
    const profile = await findProfileBySlug(req.params.slug);
    if (!profile) return res.status(404).json({ error: 'Not found' });

    const supabase = getSupabaseAdmin();
    const { data: packages, error } = await supabase
      .from('service_packages')
      .select('id, name, description, price, currency, photo_url')
      .eq('user_id', profile.user_id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    res.json({
      business: publicBusiness(profile),
      packages: (packages || []).map((p) => ({
        id: p.id,
        name: p.name || '',
        description: p.description || '',
        price: p.price,
        currency: p.currency || 'GBP',
        photo_url: p.photo_url || '',
      })),
    });
  } catch (err) {
    console.error('[public/enquiry GET]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ─── POST /api/public/enquiry/:slug ──────────────────────────────────
router.post('/enquiry/:slug', async (req, res) => {
  if (!guardConfigured(res)) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

    const profile = await findProfileBySlug(req.params.slug);
    if (!profile) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};

    // Honeypot: bots fill every field. Pretend success, store nothing.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.json({ ok: true });
    }

    const contact_name = clip(body.contact_name, 120);
    const contact_email = clip(body.contact_email, 200);
    const contact_phone = clip(body.contact_phone, 60);
    if (!contact_name) return res.status(400).json({ error: 'Name is required' });
    if (!contact_email && !contact_phone) {
      return res.status(400).json({ error: 'An email or phone number is required' });
    }

    const supabase = getSupabaseAdmin();

    // Backstop: cap enquiries per musician per day.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.user_id)
      .gte('created_at', dayStart.toISOString());
    if ((count || 0) >= 50) {
      return res.status(429).json({ error: 'Too many enquiries today. Please try again tomorrow.' });
    }

    // Only accept a package that actually belongs to this musician.
    let package_id = null;
    let packageName = '';
    if (typeof body.package_id === 'string' && body.package_id) {
      const { data: pkg } = await supabase
        .from('service_packages')
        .select('id, name')
        .eq('id', body.package_id)
        .eq('user_id', profile.user_id)
        .maybeSingle();
      if (pkg) {
        package_id = pkg.id;
        packageName = pkg.name || '';
      }
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        user_id: profile.user_id,
        contact_name,
        contact_email,
        contact_phone,
        event_date: parseDateOnly(body.event_date),
        event_type: clip(body.event_type, 120),
        location: clip(body.location, 300),
        message: clip(body.message, 2000),
        package_id,
        status: 'new',
        source: 'enquiry_page',
      })
      .select('id')
      .single();
    if (error) throw error;

    await notifyUser(profile.user_id, {
      type: 'lead_new',
      title: 'New enquiry',
      body: `${contact_name}${packageName ? ` — ${packageName}` : ''}${body.event_date ? ` (${body.event_date})` : ''}`,
      url: `/LeadDetail?id=${lead.id}`,
      tag: `lead-new-${lead.id}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[public/enquiry POST]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ─── Quote helpers ───────────────────────────────────────────────────
async function loadQuoteByToken(token) {
  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, user_id, contact_name, contact_email, contact_phone, event_date, event_type, location, package_id, status, document_id, client_id, work_event_id')
    .eq('public_token', token)
    .maybeSingle();
  if (error) throw error;
  if (!lead || !lead.document_id) return null;

  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, document_number, status, currency, line_items, subtotal, discount_amount, tax_rate, tax_amount, total, valid_until, notes, work_event_id, client_id')
    .eq('id', lead.document_id)
    .maybeSingle();
  if (docErr) throw docErr;
  if (!doc) return null;

  return { lead, doc };
}

function quoteStatus(lead, doc) {
  if (lead.status === 'accepted' || doc.status === 'accepted') return 'accepted';
  if (lead.status === 'declined' || lead.status === 'lost' || doc.status === 'rejected') return 'declined';
  if (doc.valid_until) {
    const today = new Date().toISOString().slice(0, 10);
    if (doc.valid_until < today) return 'expired';
  }
  return 'sent';
}

// ─── GET /api/public/quote/:token ────────────────────────────────────
router.get('/quote/:token', async (req, res) => {
  if (!guardConfigured(res)) return;
  try {
    const found = await loadQuoteByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const { lead, doc } = found;

    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('business_profiles')
      .select('business_name, logo, logo_url, enquiry_headline, enquiry_intro')
      .eq('user_id', lead.user_id)
      .maybeSingle();

    res.json({
      business: publicBusiness(profile),
      quote: {
        document_number: doc.document_number || '',
        contact_name: lead.contact_name || '',
        event_date: lead.event_date || '',
        line_items: Array.isArray(doc.line_items)
          ? doc.line_items.map((li) => ({
              description: li.description || '',
              quantity: li.quantity ?? 1,
              unit_price: li.unit_price ?? 0,
              total: li.total ?? li.unit_price ?? 0,
            }))
          : [],
        discount_amount: doc.discount_amount || 0,
        tax_rate: doc.tax_rate || 0,
        tax_amount: doc.tax_amount || 0,
        total: doc.total || 0,
        currency: doc.currency || 'GBP',
        valid_until: doc.valid_until || '',
        notes: doc.notes || '',
        status: quoteStatus(lead, doc),
      },
    });
  } catch (err) {
    console.error('[public/quote GET]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ─── POST /api/public/quote/:token/accept ────────────────────────────
router.post('/quote/:token/accept', async (req, res) => {
  if (!guardConfigured(res)) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

    const found = await loadQuoteByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const { lead, doc } = found;

    // Idempotent: an already-accepted quote returns the same success payload.
    if (lead.status === 'accepted') return res.json({ ok: true });
    const status = quoteStatus(lead, doc);
    if (status === 'declined') return res.status(409).json({ error: 'This quote has been declined.' });
    if (status === 'expired') return res.status(409).json({ error: 'This quote has expired.' });

    const supabase = getSupabaseAdmin();

    // Race guard: only one caller flips the lead to accepted.
    const { data: won, error: raceErr } = await supabase
      .from('leads')
      .update({ status: 'accepted', accepted_at: new Date().toISOString(), last_activity_at: new Date().toISOString() })
      .eq('id', lead.id)
      .neq('status', 'accepted')
      .select('id');
    if (raceErr) throw raceErr;
    if (!won || won.length === 0) return res.json({ ok: true });

    // Ensure a client exists for this contact.
    let clientId = lead.client_id || doc.client_id || null;
    if (!clientId && lead.contact_name) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', lead.user_id)
        .ilike('name', lead.contact_name)
        .maybeSingle();
      if (existing) {
        clientId = existing.id;
      } else {
        const { data: created, error: clientErr } = await supabase
          .from('clients')
          .insert({
            user_id: lead.user_id,
            name: lead.contact_name,
            client_type: 'other',
            emails: lead.contact_email ? [lead.contact_email] : [],
            phones: lead.contact_phone ? [lead.contact_phone] : [],
          })
          .select('id')
          .single();
        if (clientErr) console.error('[public/accept] client create failed:', clientErr.message);
        else clientId = created.id;
      }
    }

    // Create the confirmed event.
    let workEventId = lead.work_event_id || null;
    if (!workEventId) {
      let packageName = '';
      if (lead.package_id) {
        const { data: pkg } = await supabase
          .from('service_packages')
          .select('name')
          .eq('id', lead.package_id)
          .maybeSingle();
        packageName = pkg?.name || '';
      }
      const { data: event, error: eventErr } = await supabase
        .from('work_events')
        .insert({
          user_id: lead.user_id,
          title: `${packageName || lead.event_type || 'Event'} — ${lead.contact_name}`,
          event_type: 'Gig',
          status: 'confirmed',
          date: lead.event_date || null,
          client_id: clientId,
          location_address: lead.location || '',
          base_price: doc.total || 0,
          total_price: doc.total || 0,
          currency: doc.currency || 'GBP',
          base_price_locked: true,
          payload: { lead_id: lead.id },
        })
        .select('id')
        .single();
      if (eventErr) console.error('[public/accept] event create failed:', eventErr.message);
      else workEventId = event.id;
    }

    // Mark the estimate accepted and link everything up.
    const { error: docUpdateErr } = await supabase
      .from('documents')
      .update({ status: 'accepted', work_event_id: workEventId, client_id: clientId })
      .eq('id', doc.id);
    if (docUpdateErr) console.error('[public/accept] document update failed:', docUpdateErr.message);

    await supabase.from('document_activity_logs').insert({
      user_id: lead.user_id,
      document_id: doc.id,
      action: 'accepted',
      old_status: doc.status || '',
      new_status: 'accepted',
      details: { note: 'Accepted online by prospect' },
    });

    await supabase
      .from('leads')
      .update({ client_id: clientId, work_event_id: workEventId })
      .eq('id', lead.id);

    await notifyUser(lead.user_id, {
      type: 'lead_accepted',
      title: 'Quote accepted',
      body: `${lead.contact_name}${lead.event_date ? ` — ${lead.event_date}` : ''} accepted your quote`,
      url: `/LeadDetail?id=${lead.id}`,
      tag: `lead-accepted-${lead.id}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[public/accept POST]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ─── POST /api/public/quote/:token/decline ───────────────────────────
router.post('/quote/:token/decline', async (req, res) => {
  if (!guardConfigured(res)) return;
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

    const found = await loadQuoteByToken(req.params.token);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const { lead, doc } = found;

    if (lead.status === 'declined') return res.json({ ok: true });
    if (lead.status === 'accepted') return res.status(409).json({ error: 'This quote has already been accepted.' });

    const supabase = getSupabaseAdmin();
    await supabase
      .from('leads')
      .update({ status: 'declined', last_activity_at: new Date().toISOString() })
      .eq('id', lead.id)
      .neq('status', 'accepted');
    await supabase.from('documents').update({ status: 'rejected' }).eq('id', doc.id);

    await notifyUser(lead.user_id, {
      type: 'lead_declined',
      title: 'Quote declined',
      body: `${lead.contact_name} declined your quote`,
      url: `/LeadDetail?id=${lead.id}`,
      tag: `lead-declined-${lead.id}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[public/decline POST]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

export default router;
