import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchQuote, acceptQuote, declineQuote, money } from "./publicApi";

export default function PublicQuotePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState(null);

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
        <div className="text-center py-24">
          <p className="text-lg font-semibold text-white">Quote not found</p>
          <p className="text-sm text-gray-500 mt-2">This quote link may have changed or been removed.</p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="text-center py-24 text-gray-500 text-sm">Loading…</div>
      </Shell>
    );
  }

  const { business, quote } = data;
  const items = quote.line_items || [];

  return (
    <Shell>
      <div className="px-4 pt-10 pb-2 text-center">
        {business.logo_url && (
          <img src={business.logo_url} alt="" className="w-16 h-16 rounded-2xl object-cover mx-auto mb-4" />
        )}
        <h1 className="text-xl font-bold text-white">{business.business_name || "Your quote"}</h1>
        <p className="text-sm text-gray-400 mt-1">
          Quote {quote.document_number}
          {quote.contact_name ? ` for ${quote.contact_name}` : ""}
        </p>
        {quote.event_date && <p className="text-sm text-gray-500 mt-0.5">{formatDate(quote.event_date)}</p>}
      </div>

      <div className="px-4 mt-6 pb-16">
        <div className="rounded-2xl border border-gray-700/60 bg-gray-800/30 overflow-hidden">
          <div className="divide-y divide-gray-800">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-start justify-between gap-4 px-4 py-3.5">
                <div>
                  <p className="text-sm text-white">{item.description}</p>
                  {Number(item.quantity) > 1 && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.quantity} × {money(item.unit_price, quote.currency)}
                    </p>
                  )}
                </div>
                <p className="text-sm text-white whitespace-nowrap">{money(item.total ?? item.unit_price, quote.currency)}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-700/60 px-4 py-3.5 space-y-1.5">
            {Number(quote.discount_amount) > 0 && (
              <Row label="Discount" value={`-${money(quote.discount_amount, quote.currency)}`} muted />
            )}
            {Number(quote.tax_amount) > 0 && (
              <Row label={`Tax (${quote.tax_rate}%)`} value={money(quote.tax_amount, quote.currency)} muted />
            )}
            <div className="flex items-center justify-between pt-1">
              <p className="text-base font-semibold text-white">Total</p>
              <p className="text-xl font-bold text-white">{money(quote.total, quote.currency)}</p>
            </div>
          </div>
        </div>

        {quote.notes && (
          <p className="text-sm text-gray-400 mt-4 whitespace-pre-line px-1">{quote.notes}</p>
        )}

        <div className="mt-8">
          {quote.status === "accepted" && (
            <StatusPanel tone="green" title="Quote accepted">
              {business.business_name ? `${business.business_name} will` : "We'll"} be in touch to confirm the details. Thank you!
            </StatusPanel>
          )}
          {quote.status === "declined" && (
            <StatusPanel tone="gray" title="Quote declined">
              If you changed your mind or want to discuss options, just reply to the email you received.
            </StatusPanel>
          )}
          {quote.status === "expired" && (
            <StatusPanel tone="amber" title="This quote has expired">
              Get in touch{business.business_name ? ` with ${business.business_name}` : ""} for an updated quote.
            </StatusPanel>
          )}
          {quote.status === "sent" && (
            <>
              {quote.valid_until && (
                <p className="text-xs text-gray-500 text-center mb-4">Valid until {formatDate(quote.valid_until)}</p>
              )}
              {actionError && <p className="text-sm text-red-400 text-center mb-3">{actionError}</p>}
              <button
                onClick={handleAccept}
                disabled={working}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold rounded-xl py-3.5 text-sm transition-colors"
              >
                {working ? "One moment…" : "Accept quote"}
              </button>
              <button
                onClick={handleDecline}
                disabled={working}
                className="w-full text-gray-500 hover:text-gray-300 text-xs mt-4 transition-colors"
              >
                Decline
              </button>
            </>
          )}
        </div>
      </div>
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

function Row({ label, value, muted }) {
  return (
    <div className="flex items-center justify-between">
      <p className={`text-sm ${muted ? "text-gray-400" : "text-white"}`}>{label}</p>
      <p className={`text-sm ${muted ? "text-gray-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

function StatusPanel({ tone, title, children }) {
  const tones = {
    green: "bg-green-950/40 border-green-700/30 text-green-400",
    gray: "bg-gray-800 border-gray-700 text-gray-400",
    amber: "bg-amber-950/40 border-amber-700/30 text-amber-400",
  };
  return (
    <div className={`rounded-2xl border px-4 py-5 text-center ${tones[tone]}`}>
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-gray-400 mt-1.5">{children}</p>
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
