import { useState, useEffect } from "react";
import { appClient } from "@/api/appClient";
import { Link } from "react-router-dom";
import { createPageUrl, currencySymbol } from "@/utils";
import { Receipt, FileText, ChevronRight } from "lucide-react";

const statusColors = {
  draft: "text-gray-400",
  sent: "text-blue-400",
  paid: "text-green-400",
  overdue: "text-red-400",
  accepted: "text-green-400",
  rejected: "text-red-400",
  converted: "text-indigo-400",
};

export default function ClientFinancialSummary({ clientId }) {
  const [invoices, setInvoices] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    appClient.entities.Document.filter({ client_id: clientId }, "-created_at").then(docs => {
      setInvoices(docs.filter(d => d.document_type === "invoice"));
      setEstimates(docs.filter(d => d.document_type === "estimate"));
      setLoading(false);
    });
  }, [clientId]);

  if (!clientId) return null;

  const totalEarned = invoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.total || i.subtotal || 0), 0);
  const totalOutstanding = invoices.filter(i => i.status === "sent").reduce((s, i) => s + (i.total || i.subtotal || 0), 0);

  if (loading) return <div className="h-20 bg-gray-800 rounded-xl animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-500 mb-1">Total Earned</p>
          <p className="text-lg font-bold text-green-400 sensitive">{currencySymbol()}{totalEarned.toFixed(2)}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3">
          <p className="text-xs text-gray-500 mb-1">Outstanding</p>
          <p className="text-lg font-bold text-yellow-400 sensitive">{currencySymbol()}{totalOutstanding.toFixed(2)}</p>
        </div>
      </div>

      {invoices.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Invoices ({invoices.length})</p>
          <div className="space-y-1">
            {invoices.slice(0, 5).map(inv => (
              <Link key={inv.id} to={createPageUrl(`DocumentDetail?id=${inv.id}`)}
                className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 hover:bg-gray-700 transition-colors">
                <Receipt className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-200 truncate">{inv.title || "Invoice"}</span>
                <span className={`text-xs font-medium ${statusColors[inv.status] || "text-gray-400"}`}>{inv.status}</span>
                <span className="text-xs text-gray-400 sensitive">{currencySymbol(inv.currency)}{(inv.total || inv.subtotal || 0).toFixed(2)}</span>
                <ChevronRight className="w-3 h-3 text-gray-600" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {estimates.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Estimates ({estimates.length})</p>
          <div className="space-y-1">
            {estimates.slice(0, 5).map(est => (
              <Link key={est.id} to={createPageUrl(`DocumentDetail?id=${est.id}`)}
                className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 hover:bg-gray-700 transition-colors">
                <FileText className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-200 truncate">{est.title || "Estimate"}</span>
                <span className={`text-xs font-medium ${statusColors[est.status] || "text-gray-400"}`}>{est.status}</span>
                <span className="text-xs text-gray-400 sensitive">{currencySymbol(est.currency)}{(est.total || est.subtotal || 0).toFixed(2)}</span>
                <ChevronRight className="w-3 h-3 text-gray-600" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {invoices.length === 0 && estimates.length === 0 && (
        <p className="text-sm text-gray-600 italic text-center py-2">No financial history yet</p>
      )}
    </div>
  );
}
