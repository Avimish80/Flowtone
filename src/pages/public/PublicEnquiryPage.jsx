import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchEnquiryPage, submitEnquiry, money } from "./publicApi";

const inputClass =
  "w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500";

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
    } catch (err) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="text-center py-24">
          <p className="text-lg font-semibold text-white">Page not found</p>
          <p className="text-sm text-gray-500 mt-2">This enquiry link may have changed or been removed.</p>
        </div>
      </Shell>
    );
  }

  if (!page) {
    return (
      <Shell>
        <div className="text-center py-24 text-gray-500 text-sm">Loading…</div>
      </Shell>
    );
  }

  const { business, packages } = page;

  if (submitted) {
    return (
      <Shell>
        <Header business={business} />
        <div className="text-center py-16 px-4">
          <div className="w-14 h-14 rounded-full bg-green-950/60 border border-green-700/40 mx-auto flex items-center justify-center">
            <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-white mt-4">Thanks, {form.contact_name.split(" ")[0]}!</p>
          <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
            Your enquiry has been sent{business.business_name ? ` to ${business.business_name}` : ""}. You&apos;ll hear back soon.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Header business={business} />

      {packages.length > 0 && (
        <div className="px-4 mt-6">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-3">Choose an option</p>
          <div className="space-y-3">
            {packages.map((pkg) => {
              const selected = selectedId === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedId(selected ? null : pkg.id)}
                  className={`w-full text-left rounded-2xl border overflow-hidden transition-all ${
                    selected
                      ? "border-indigo-500 ring-2 ring-indigo-500/50 bg-gray-800/60"
                      : "border-gray-700/60 bg-gray-800/30 hover:border-gray-600"
                  }`}
                >
                  {pkg.photo_url && (
                    <img src={pkg.photo_url} alt={pkg.name} className="w-full h-44 object-cover" loading="lazy" />
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold text-white">{pkg.name}</p>
                      {pkg.price != null && (
                        <p className="text-base font-bold text-indigo-400 whitespace-nowrap">{money(pkg.price, pkg.currency)}</p>
                      )}
                    </div>
                    {pkg.description && <p className="text-sm text-gray-400 mt-1.5 whitespace-pre-line">{pkg.description}</p>}
                    {selected && <p className="text-xs text-indigo-400 font-medium mt-2">Selected</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="px-4 mt-8 pb-16 space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Your details</p>
        <input className={inputClass} placeholder="Your name *" value={form.contact_name} onChange={setField("contact_name")} autoComplete="name" />
        <input className={inputClass} type="email" placeholder="Email" value={form.contact_email} onChange={setField("contact_email")} autoComplete="email" />
        <input className={inputClass} type="tel" placeholder="Phone" value={form.contact_phone} onChange={setField("contact_phone")} autoComplete="tel" />

        <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold pt-3">Your event</p>
        <input className={inputClass} type="date" value={form.event_date} onChange={setField("event_date")} aria-label="Event date" />
        <input className={inputClass} placeholder="Type of event (wedding, party, corporate…)" value={form.event_type} onChange={setField("event_type")} />
        <input className={inputClass} placeholder="Location / venue" value={form.location} onChange={setField("location")} />
        <textarea className={`${inputClass} min-h-[100px]`} placeholder="Tell us more about what you have in mind…" value={form.message} onChange={setField("message")} />

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

        {submitError && <p className="text-sm text-red-400">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors"
        >
          {submitting ? "Sending…" : "Send enquiry"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-xl mx-auto">{children}</div>
    </div>
  );
}

function Header({ business }) {
  return (
    <div className="px-4 pt-10 pb-2 text-center">
      {business.logo_url && (
        <img src={business.logo_url} alt="" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-4" />
      )}
      <h1 className="text-2xl font-bold text-white">{business.business_name || "Get a quote"}</h1>
      {business.enquiry_headline && <p className="text-base text-indigo-300 mt-2 font-medium">{business.enquiry_headline}</p>}
      {business.enquiry_intro && <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto whitespace-pre-line">{business.enquiry_intro}</p>}
    </div>
  );
}
