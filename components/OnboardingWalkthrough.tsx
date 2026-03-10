"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "transcribe_onboarding_complete";

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Transcribe",
    body: "Upload a video/audio file or paste a YouTube URL to generate a transcript with word-level timestamps.",
  },
  {
    title: "Leave a Review",
    body: "Once a transcript is ready, scroll down to the Reviews section to leave an overall review with a star rating.",
  },
  {
    title: "Give Feedback on Specific Text",
    body: "Select any words in the transcript by clicking and dragging. A popup will appear where you can leave targeted feedback on that exact section.",
  },
  {
    title: "Jump to Timestamps",
    body: "Each feedback item shows a timestamp. Click it to scroll up to the video player and jump to that moment — playback starts automatically.",
  },
];

export default function OnboardingWalkthrough() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {}
    // Small delay so the page renders first
    const timer = setTimeout(() => setVisible(true), 600);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  }, []);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  }, [step, dismiss]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        {/* Step indicator */}
        <div className="mb-4 flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-blue-500" : "bg-neutral-700"
              }`}
            />
          ))}
        </div>

        <h2 className="mb-2 text-lg font-semibold text-neutral-100">
          {current.title}
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-neutral-400">
          {current.body}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={dismiss}
            className="text-sm text-neutral-500 transition-colors hover:text-neutral-300"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="rounded-lg bg-neutral-800 px-4 py-2 text-sm transition-colors hover:bg-neutral-700"
              >
                Back
              </button>
            )}
            <button
              onClick={next}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-500"
            >
              {isLast ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
