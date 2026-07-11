import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchEnquiryPage, submitEnquiry } from "./publicApi";

// Public landing page — the musician's shareable offer page. Deliberately
// NOT tailored to anyone and NOT showing prices: it presents the options,
// collects the prospect's details, and the personal quote (with the price)
// comes afterwards on their own /q/ link.

const inputClass =
  "w-full bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-[15px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100 transition-shadow";

export default function PublicEnquiryPage() {
  const { slug } = useParams();
  const [page, setPage] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    event_date: "",
    event_type: "",
    location: "",
    message: "",
    website: "", // honeypot — real users never fill this
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchEnquiryPage(slug)
      .then((data) => alive && setPage(data))
      .catch((err) => alive && setLoadError(err));
    return () => {
      alive = false;
    };
  }, [slug]);

  const setField = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!form.contact_name.trim()) {
      setSubmitError("Please tell us your name.");
      return;
    }
    if (!form.contact_email.trim() && !form.contact_phone.trim()) {
      setSubmitError("Please leave an email or phone number so we can get back to you.");
      return;
    }
    setSubmitting(true);
    try {
      await submitEnquiry(slug, { ...form, package_id: selectedId });
      setSubmitted(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="text-center py-28 px-6">
          <p className="text-xl font-semibold text-slate-900">Page not found</p>
          <p className="text-sm text-slate-500 mt-2">This link may have changed or been removed.</p>
        </div>
      </Shell>
    );
  }

  if (!page) {
    return (
      <Shell>
        <div className="text-center py-28 text-slate-400 text-sm">Loading…</div>
      </Shell>
    );
  }

  const { business, packages } = page;

  if (submitted) {
    return (
      <Shell>
        <Header business={business} />
        <div className="text-center py-20 px-6 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 mx-auto flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-2xl font-bold tracking-tight text-slate-900 mt-6">
            Thanks, {form.contact_name.trim().split(" ")[0]}!
          </p>
          <p className="text-[15px] leading-relaxed text-slate-500 mt-3">
            Your enquiry is on its way{business.business_name ? ` to ${business.business_name}` : ""}.
            You&apos;ll receive a personal quote made just for your event.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header business={business} />

      {packages.length > 0 && (
        <section className="px-6 mt-10">
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-semibold mb-4 text-center">
            What would you like?
          </p>
          <div className="space-y-4">
            {packages.map((pkg) => {
              const selected = selectedId === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedId(selected ? null : pkg.id)}
                  className={`w-full text-left rounded-3xl bg-white overflow-hidden transition-all shadow-sm ${
                    selected
                      ? "ring-2 ring-slate-900 shadow-md"
                      : "border border-slate-200 hover:shadow-md hover:border-slate-300"
                  }`}
                >
                  {pkg.photo_url && (
                    <img src={pkg.photo_url} alt={pkg.name} className="w-full h-52 object-cover" loading="lazy" />
                  )}
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-bold tracking-tight text-slate-900">{pkg.name}</p>
                      <span
                        className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                          selected ? "bg-slate-900 border-slate-900" : "border-slate-300"
                        }`}
                      >
                        {selected && (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </div>
                    {pkg.description && (
                      <p className="text-[15px] leading-relaxed text-slate-500 mt-1.5 whitespace-pre-line">{pkg.description}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <form onSubmit={handleSubmit} className="px-6 mt-12 pb-20 max-w-md mx-auto space-y-3">
        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-semibold text-center mb-4">
          Tell us about your event
        </p>
        <input className={inputClass} placeholder="Your name" value={form.contact_name} onChange={setField("contact_name")} autoComplete="name" />
        <input className={inputClass} type="email" placeholder="Email" value={form.contact_email} onChange={setField("contact_email")} autoComplete="email" />
        <input className={inputClass} type="tel" placeholder="Phone" value={form.contact_phone} onChange={setField("contact_phone")} autoComplete="tel" />
        <input className={inputClass} type="date" value={form.event_date} onChange={setField("event_date")} aria-label="Event date" />
        <input className={inputClass} placeholder="Type of event (wedding, party, corporate…)" value={form.event_type} onChange={setField("event_type")} />
        <input className={inputClass} placeholder="Location / venue" value={form.location} onChange={setField("location")} />
        <textarea className={`${inputClass} min-h-[110px]`} placeholder="Tell us more about what you have in mind…" value={form.message} onChange={setField("message")} />

        <input
          type="text"
          name="website"
          value={form.website}
          onChange={setField("website")}
          className="hidden"
          tabIndex="-1"
          autoComplete="off"
          aria-hidden="true"
        />

        {submitError && <p className="text-sm text-red-500 text-center">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold rounded-2xl py-4 text-[15px] tracking-tight transition-colors shadow-sm mt-2"
        >
          {submitting ? "Sending…" : "Get my personal quote"}
        </button>
        <p className="text-xs text-slate-400 text-center pt-1">
          No payment, no commitment — you&apos;ll receive a personal quote to review.
        </p>
      </form>

      <footer className="pb-10 text-center">
        <p className="text-[11px] text-slate-300">{business.business_name || ""}</p>
      </footer>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#fafaf7] text-slate-900" style={{ colorScheme: "light" }}>
      <div className="max-w-2xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ business }) {
  return (
    <header className="px-6 pt-14 pb-2 text-center">
      {business.logo_url && (
        <img src={business.logo_url} alt="" className="w-16 h-16 rounded-full object-cover mx-auto mb-5 shadow-sm" />
      )}
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
        {business.business_name || "Get a quote"}
      </h1>
      {business.enquiry_headline && (
        <p className="text-lg text-slate-600 mt-3 font-medium">{business.enquiry_headline}</p>
      )}
      {business.enquiry_intro && (
        <p className="text-[15px] leading-relaxed text-slate-500 mt-3 max-w-md mx-auto whitespace-pre-line">{business.enquiry_intro}</p>
      )}
    </header>
  );
}
