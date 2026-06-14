import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";

/**
 * Returns a goBack() function that steps back through in-app history when the
 * user navigated here from another page, or falls back to a specific page for
 * direct-link / bookmark / PWA-cold-start access.
 *
 * Uses React Router's location.key ("default" only for the very first entry)
 * rather than window.history.length, which is unreliable inside an installed
 * PWA and can leave the user with a dead Back button.
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
