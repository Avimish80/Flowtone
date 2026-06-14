import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Returns a goBack() function that pops in-app history when there is some,
 * or falls back to a specific page for direct-link / deep-link / PWA cold-start.
 *
 * Uses React Router's location.key (which is "default" only for the very first
 * entry with no prior in-app navigation) instead of window.history.length —
 * the latter is unreliable in installed PWAs, where it stays > 1 across the
 * session and navigate(-1) can dead-end outside the app.
 *
 * @param {string} fallbackPage  Page name to navigate to if there's no history
 * @returns {Function}
 */
export function useGoBack(fallbackPage) {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    if (location.key && location.key !== "default") {
      navigate(-1);
    } else {
      navigate(createPageUrl(fallbackPage));
    }
  };
}
