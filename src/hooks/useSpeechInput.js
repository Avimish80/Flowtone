import { useState, useRef, useCallback } from "react";

/**
 * Uses the browser's built-in Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * to capture a single utterance and return the transcript.
 *
 * Returns: { listening, transcript, start, stop, supported }
 */
export function useSpeechInput() {
  const SpeechRecognition =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const supported = Boolean(SpeechRecognition);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef(null);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const start = useCallback((onResult) => {
    if (!supported) return;

    // Clean up any previous instance
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setTranscript("");
    };

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      setTranscript(text);
      if (onResult && text) {
        onResult(text);
      }
    };

    recognition.onerror = (event) => {
      // Silently ignore "no-speech" and "aborted"; surface others to console
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.warn("SpeechRecognition error:", event.error);
      }
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.warn("SpeechRecognition failed to start:", err);
      setListening(false);
      recognitionRef.current = null;
    }
  }, [supported, SpeechRecognition]);

  return { listening, transcript, start, stop, supported };
}
