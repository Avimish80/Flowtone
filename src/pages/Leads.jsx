import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { createPageUrl } from "@/utils";
import { usePageState } from "@/hooks/usePageState";
import { useToast } from "@/components/ui/use-toast";
import { Link2, Package } from "lucide-react";

const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  accepted: "Accepted",
  declined: "Declined",
  lost: "Lost",
};

const STATUS_BAR = {
  new: "bg-indigo-500",
  contacted: "bg-yellow-500",
  quoted: "bg-blue-500",
  accepted: "bg-green-500",
  declined: "bg-gray-600",
  lost: "bg-gray-600",
};

const STATUS_BADGE = {
  new: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  contacted: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  quoted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  accepted: "bg-green-500/20 text-green-400 border-green-500/30",
  declined: "bg-gray-800 text-gray-500 border-gray-700",
  lost: "bg-gray-800 text-gray-500 border-gray-700",
};

export default function Leads() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [leads, setLeads] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = usePageState("leads_filter", "all");

  useEffect(() => {
    Promise.all([
      appClient.entities.Lead.list("-created_at"),
      appClient.entities.ServicePackage.list(),
    ])
      .then(([leadRows, pkgRows]) => {
        setLeads(leadRows);
        setPackages(pkgRows);
      })
      .finally(() => setLoading(false));
  }, []);

  const packageMap = useMemo(
    () => Object.fromEntries(packages.map((p) => [p.id, p])),
    [packages]
  );

  const counts = useMemo(() => {
    const c = { new: 0, quoted: 0, accepted: 0, closed: 0 };
    for (const lead of leads) {
      if (lead.status === "new" || lead.status === "contacted") c.new += 1;
      if (lead.status === "quoted") c.quoted += 1;
      if (lead.status === "accepted") c.accepted += 1;
      if (lead.status === "declined" || lead.status === "lost") c.closed += 1;
    }
    return c;
  }, [leads]);

  const filtered = useMemo(() => {
    if (filter === "all") return leads;
    if (filter === "new") return leads.filter((l) => l.status === "new" || l.status === "contacted");
    if (filter === "closed") return leads.filter((l) => l.status === "declined" || l.status === "lost");
    return leads.filter((l) => l.status === filter);
  }, [leads, filter]);

  const toggleFilter = (key) => setFilter(filter === key ? "all" : key);

  const handleShare = async () => {
    const profile = await appClient.helpers.ensureSingletonEntity("BusinessProfile");
    if (!profile.public_slug) {
      navigate(createPageUrl("Packages"));
      return;
    }
    const url = `${window.location.origin}/p/${profile.public_slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: profile.business_name || "Get a quote", url });
        return;
      }
    } catch { /* fall through */ }
    try {
      await navigator.clipboard.writeText(url);
      toast({ description: "Enquiry page link copied" });
    } catch {
      toast({ description: url });
    }
  };

  const tileClass = (key, active) =>
    `rounded-xl p-3 text-center transition-all border ${
      active ? "ring-2 ring-indigo-500 scale-[1.03]" : ""
    } ${
      key === "new" && counts.new > 0
        ? "bg-indigo-950/60 border-indigo-700/40"
        : key === "accepted" && counts.accepted > 0
          ? "bg-green-950/40 border-green-700/30"
          : "bg-gray-800/50 border-gray-700/40"
    }`;

  return (
    <div className="p-4 max-w-xl mx-auto pb-24">
      <div className="flex items-center justify-end gap-4 mb-4">
        <Link to={createPageUrl("Packages")} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
          <Package className="w-3 h-3" /> Packages
        </Link>
        <button onClick={handleShare} className="text-gray-500 hover:text-gray-300 text-xs flex items-center gap-1 transition-colors">
          <Link2 className="w-3 h-3" /> Share enquiry page
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 mb-5">
        <button onClick={() => toggleFilter("new")} className={tileClass("new", filter === "new")}>
          <p className={`text-xl font-bold ${counts.new > 0 ? "text-indigo-300" : "text-white"}`}>{counts.new}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">New</p>
        </button>
        <button onClick={() => toggleFilter("quoted")} className={tileClass("quoted", filter === "quoted")}>
          <p className="text-xl font-bold text-white">{counts.quoted}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Quoted</p>
        </button>
        <button onClick={() => toggleFilter("accepted")} className={tileClass("accepted", filter === "accepted")}>
          <p className={`text-xl font-bold ${counts.accepted > 0 ? "text-green-400" : "text-white"}`}>{counts.accepted}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Won</p>
        </button>
        <button onClick={() => toggleFilter("closed")} className={tileClass("closed", filter === "closed")}>
          <p className="text-xl font-bold text-gray-400">{counts.closed}</p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Closed</p>
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 text-center py-16">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-base font-semibold text-white">
            {leads.length === 0 ? "No leads yet" : "Nothing here"}
          </p>
          {leads.length === 0 && (
            <>
              <p className="text-sm text-gray-500 mt-2 max-w-xs mx-auto">
                Share your enquiry page and new enquiries will land here automatically.
              </p>
              <button
                onClick={handleShare}
                className="mt-6 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                Share enquiry page
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((lead) => {
            const pkg = packageMap[lead.package_id];
            return (
              <Link
                key={lead.id}
                to={createPageUrl("LeadDetail?id=" + lead.id)}
                className="flex items-stretch rounded-xl border border-gray-700/60 bg-gray-800/30 hover:bg-gray-800/60 overflow-hidden transition-colors"
              >
                <div className={`w-1 flex-shrink-0 ${STATUS_BAR[lead.status] || "bg-gray-600"}`} />
                <div className="flex-1 px-3.5 py-3 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{lead.contact_name}</p>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${STATUS_BADGE[lead.status] || ""}`}>
                      {STATUS_LABELS[lead.status] || lead.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {[pkg?.name, lead.event_type, formatShortDate(lead.event_date)].filter(Boolean).join(" · ") || "No details yet"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatShortDate(value) {
  if (!value) return "";
  try {
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}
