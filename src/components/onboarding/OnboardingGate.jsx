import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getAssistantProfile, isOnboarded } from "@/lib/assistantProfile";
import OnboardingFlow from "./OnboardingFlow";

export default function OnboardingGate({ children }) {
  const [status, setStatus] = useState("loading"); // "loading" | "needed" | "done"

  useEffect(() => {
    const force = new URLSearchParams(window.location.search).has("force_onboarding");

    if (isPreviewModeEnabled() && !force) {
      setStatus("done");
      return;
    }

    if (force) {
      setStatus("needed");
      return;
    }

    getAssistantProfile()
      .then((profile) => setStatus(isOnboarded(profile) ? "done" : "needed"))
      .catch((err) => {
        // Fail open — a network blip must never lock the user out
        console.warn("OnboardingGate: could not load profile", err);
        setStatus("done");
      });
  }, []);

  if (status === "loading") {
    return (
      <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
        <Sparkles className="w-8 h-8 text-indigo-500 animate-pulse" />
      </div>
    );
  }

  if (status === "needed") {
    return <OnboardingFlow onFinish={() => setStatus("done")} />;
  }

  return children;
}
