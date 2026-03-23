import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Estimates page now redirects to Finance with the Estimates tab pre-selected.
 * This keeps existing bookmarks/links to /Estimates working.
 */
export default function Estimates() {
  const navigate = useNavigate();

  useEffect(() => {
    try {
      sessionStorage.setItem("mos_finance_tab", JSON.stringify("estimates"));
    } catch { /* ignore */ }
    navigate(createPageUrl("Finance"), { replace: true });
  }, [navigate]);

  return <div className="p-4 text-gray-400">Redirecting…</div>;
}
