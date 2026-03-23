import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Returns a goBack() function that uses browser history when available,
 * or falls back to a specific page for direct-link / bookmark access.
 *
 * @param {string} fallbackPage  Page name to navigate to if there's no history
 * @returns {Function}
 */
export function useGoBack(fallbackPage) {
  const navigate = useNavigate();

  return () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(createPageUrl(fallbackPage));
    }
  };
}
