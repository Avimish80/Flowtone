import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchQuote, acceptQuote, declineQuote, money } from "./publicApi";

// Personal offer page — prepared for one client, by name. Deliberately styled
// as a light, editorial proposal (matching the invoice templates' feel), NOT
// the app's dark dashboard UI: the client should feel this was made for them.

export default function PublicQuotePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmDecline, setConfirmDecline] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchQuote(token)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setLoadError(err));
    return () => {
      alive = false;
    };
  }, [token]);

  const handleAccept = async () => {
    setActionError(null);
    setWorking(true);
    try {
      await acceptQuote(token);
      setData((d) => ({ ...d, quote: { ...d.quote, status: "accepted" } }));
    } catch (err) {
      setActionError(err.message || "Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  const handleDecline = async () => {
    setActionError(null);
    setWorking(true);
    try {
      await declineQuote(token);
      setData((d) => ({ ...d, quote: { ...d.quote, status: "declined" } }));
    } catch (err) {
      setActionError(err.message || "Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <div className="text-center py-28 px-6">
          <p className="text-xl font-semibold text-slate-900">This page isn&apos;t available</p>
          <p className="text-sm text-slate-500 mt-2">The link may have changed or expired.</p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="text-center py-28 text-slate-400 text-sm">Loading…</div>
      </Shell>
    );
  }

  const { business, quote } = data;
  const pkg = data.package;
  const firstName = (quote.contact_name || "").trim().split(" ")[0];
  const items = quote.line_items || [];
  const eventLine = [
    quote.event_type,
    quote.event_date ? formatDate(quote.event_date) : "",
    quote.location,
  ].filter(Boolean).join("  ·  ");

  return (
    <Shell>
      {/* Business mark */}
      <header className="pt-12 pb-2 px-6 text-center">
        {business.logo_url && (
          <img src={business.logo_url} alt="" className="w-14 h-14 rounded-full object-cover mx-auto mb-4 shadow-sm" />
        )}
        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-semibold">
          {business.business_name || "Your quote"}
        </p>
      </header>

      {/* Personal greeting */}
      <section className="px-6 pt-6 pb-2 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          {firstName ? `Prepared for ${firstName}` : "Your personal quote"}
        </h1>
        {eventLine && (
          <p className="text-sm text-slate-500 mt-3">{eventLine}</p>
        )}
      </section>

      <section className="px-6 mt-8">
        {/* Package hero photo */}
        {pkg?.photo_url && (
          <img
            src={pkg.photo_url}
            alt={pkg.name}
            className="w-full h-56 sm:h-72 object-cover rounded-3xl shadow-md"
          />
        )}

        {/* The offer */}
        <div className={`bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden ${pkg?.photo_url ? "-mt-8 relative mx-3 sm:mx-6" : ""}`}>
          <div className="p-6 sm:p-8">
            {pkg && (
              <>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">{pkg.name}</h2>
                {pkg.description && (
                  <p className="text-[15px] leading-relaxed text-slate-600 mt-2 whitespace-pre-line">{pkg.description}</p>
                )}
              </>
            )}

            {(items.length > 1 || !pkg) && (
              <div className={`${pkg ? "mt-6 pt-5 border-t border-slate-100" : ""} space-y-2.5`}>
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-baseline justify-between gap-4">
                    <p className="text-sm text-slate-700">
                      {item.description}
                      {Number(item.quantity) > 1 && (
                        <span className="text-slate-400"> × {item.quantity}</span>
                      )}
                    </p>
                    <p className="text-sm text-slate-700 whitespace-nowrap tabular-nums">
                      {money(item.total ?? item.unit_price, quote.currency)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 pt-5 border-t border-slate-200 space-y-1.5">
              {Number(quote.discount_amount) > 0 && (
                <div className="flex items-baseline justify-between text-sm text-slate-500">
                  <p>Discount</p>
                  <p className="tabular-nums">-{money(quote.discount_amount, quote.currency)}</p>
                </div>
              )}
              {Number(quote.tax_amount) > 0 && (
                <div className="flex items-baseline justify-between text-sm text-slate-500">
                  <p>Tax ({quote.tax_rate}%)</p>
                  <p className="tabular-nums">{money(quote.tax_amount, quote.currency)}</p>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <p className="text-base font-semibold text-slate-900">Total</p>
                <p className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {money(quote.total, quote.currency)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Note from the musician */}
        {quote.notes && (
          <div className="mt-6 px-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
              A note from {business.business_name || "us"}
            </p>
            <p className="text-[15px] leading-relaxed text-slate-600 whitespace-pre-line">{quote.notes}</p>
          </div>
        )}
      </section>

      {/* Action area */}
      <section className="px-6 mt-10 pb-20 max-w-md mx-auto">
        {quote.status === "accepted" && (
          <StatusPanel tone="green" title={firstName ? `Wonderful, ${firstName}!` : "Wonderful!"}>
            Your booking is confirmed{quote.event_date ? ` for ${formatDate(quote.event_date)}` : ""}.
            {" "}{business.business_name || "We"} will be in touch with the next steps.
          </StatusPanel>
        )}
        {quote.status === "declined" && (
          <StatusPanel tone="gray" title="Quote declined">
            No problem at all — if you change your mind or want to talk options,
            just reply to the email you received.
          </StatusPanel>
        )}
        {quote.status === "expired" && (
          <StatusPanel tone="amber" title="This quote has expired">
            Get in touch{business.business_name ? ` with ${business.business_name}` : ""} for an updated quote — the date may still be available.
          </StatusPanel>
        )}
        {quote.status === "sent" && (
          <>
            {actionError && <p className="text-sm text-red-500 text-center mb-3">{actionError}</p>}
            <button
              onClick={handleAccept}
              disabled={working}
              className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-semibold rounded-2xl py-4 text-[15px] tracking-tight transition-colors shadow-sm"
            >
              {working ? "One moment…" : "Accept this quote"}
            </button>
            {quote.valid_until && (
              <p className="text-xs text-slate-400 text-center mt-3">
                This offer is valid until {formatDate(quote.valid_until)}
              </p>
            )}
            <div className="text-center mt-6">
              {confirmDecline ? (
                <span className="text-xs text-slate-500">
                  Are you sure?{" "}
                  <button onClick={handleDecline} disabled={working} className="text-red-500 font-medium underline underline-offset-2">
                    Yes, decline
                  </button>
                  {"  ·  "}
                  <button onClick={() => setConfirmDecline(false)} className="text-slate-500 underline underline-offset-2">
                    Go back
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDecline(true)} className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
                  Decline this quote
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <footer className="pb-10 text-center">
        <p className="text-[11px] text-slate-300">
          {business.business_name || ""}{quote.document_number ? `  ·  ${quote.document_number}` : ""}
        </p>
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

function StatusPanel({ tone, title, children }) {
  const tones = {
    green: "bg-emerald-50 border-emerald-200 text-emerald-900",
    gray: "bg-slate-100 border-slate-200 text-slate-700",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
  };
  return (
    <div className={`rounded-2xl border px-6 py-7 text-center ${tones[tone]}`}>
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="text-sm mt-2 leading-relaxed opacity-80">{children}</p>
    </div>
  );
}

function formatDate(value) {
  try {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch {
    return value;
  }
}
