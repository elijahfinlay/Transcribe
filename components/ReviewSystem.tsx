"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Review, TranscriptFeedback, WordChunk } from "@/lib/types";

// ─── Helpers ────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Star Rating ────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  readonly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`text-lg transition-colors ${
            readonly ? "cursor-default" : "cursor-pointer"
          } ${
            star <= (hover || value)
              ? "text-yellow-400"
              : "text-neutral-600"
          }`}
        >
          &#9733;
        </button>
      ))}
    </div>
  );
}

// ─── Feedback Popover ───────────────────────────────────────────────

function FeedbackPopover({
  position,
  selectedText,
  onSubmit,
  onCancel,
}: {
  position: { x: number; y: number };
  selectedText: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed z-40 w-72 rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl"
      style={{ left: position.x, top: position.y }}
    >
      <p className="mb-2 text-xs text-neutral-500">Feedback on:</p>
      <p className="mb-3 line-clamp-2 rounded bg-neutral-800 px-2 py-1 text-sm italic text-neutral-300">
        &ldquo;{selectedText}&rdquo;
      </p>
      <textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Leave your feedback..."
        rows={3}
        className="mb-3 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!comment.trim()}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

interface ReviewSystemProps {
  chunks: WordChunk[];
  transcript: string;
  activeWordIndex: number;
  activeWordRef: RefObject<HTMLSpanElement | null>;
  onSeekToWord: (chunk: WordChunk) => void;
  onSeekToTime: (time: number) => void;
  playerRef: RefObject<HTMLElement | null>;
}

export default function ReviewSystem({
  chunks,
  transcript,
  activeWordIndex,
  activeWordRef,
  onSeekToWord,
  onSeekToTime,
  playerRef,
}: ReviewSystemProps) {
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [feedbacks, setFeedbacks] = useState<TranscriptFeedback[]>([]);
  const [reviewText, setReviewText] = useState("");
  const [reviewAuthor, setReviewAuthor] = useState("");
  const [reviewRating, setReviewRating] = useState(0);
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Text selection state
  const [selectionRange, setSelectionRange] = useState<{
    startIndex: number;
    endIndex: number;
  } | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(
    null
  );
  const [selectedText, setSelectedText] = useState("");
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Track mouse-based word selection
  const isSelectingRef = useRef(false);
  const selectionStartRef = useRef(-1);
  const [dragSelection, setDragSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const handleWordMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      isSelectingRef.current = true;
      selectionStartRef.current = index;
      setDragSelection({ start: index, end: index });
      setSelectionRange(null);
      setPopoverPos(null);
    },
    []
  );

  const handleWordMouseEnter = useCallback((index: number) => {
    if (!isSelectingRef.current) return;
    const start = selectionStartRef.current;
    setDragSelection({
      start: Math.min(start, index),
      end: Math.max(start, index),
    });
  }, []);

  const dragSelectionRef = useRef(dragSelection);
  useEffect(() => {
    dragSelectionRef.current = dragSelection;
  }, [dragSelection]);

  const onSeekToWordRef = useRef(onSeekToWord);
  useEffect(() => {
    onSeekToWordRef.current = onSeekToWord;
  }, [onSeekToWord]);

  // Attach mouseup on window so selection can't get stuck
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (!isSelectingRef.current) return;
      isSelectingRef.current = false;

      const sel = dragSelectionRef.current;
      if (!sel) return;

      const { start, end } = sel;
      if (start === end) {
        // Single word click — seek instead
        setDragSelection(null);
        if (chunks[start]) onSeekToWordRef.current(chunks[start]);
        return;
      }

      const text = chunks
        .slice(start, end + 1)
        .map((c) => c.text)
        .join("");

      setSelectionRange({ startIndex: start, endIndex: end });
      setSelectedText(text);

      // Position popover near mouse, clamped to viewport
      setPopoverPos({
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - 310)),
        y: Math.max(8, Math.min(e.clientY + 10, window.innerHeight - 250)),
      });
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [chunks]);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!popoverPos) return;
      const target = e.target as HTMLElement;
      if (target.closest(".fixed.z-40")) return;
      setPopoverPos(null);
      setSelectionRange(null);
      setDragSelection(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverPos]);

  const handleFeedbackSubmit = useCallback(
    (comment: string) => {
      if (!selectionRange) return;
      const { startIndex, endIndex } = selectionRange;
      const startTime = chunks[startIndex]?.start ?? 0;
      const endTime = chunks[endIndex]?.end ?? 0;

      const feedback: TranscriptFeedback = {
        id: generateId(),
        author: "Reviewer",
        comment,
        startIndex,
        endIndex,
        startTime,
        endTime,
        selectedText,
        createdAt: Date.now(),
      };

      setFeedbacks((prev) => [feedback, ...prev]);
      setPopoverPos(null);
      setSelectionRange(null);
      setDragSelection(null);
      setSelectedText("");
    },
    [selectionRange, chunks, selectedText]
  );

  const handleReviewSubmit = useCallback(() => {
    const trimmed = reviewText.trim();
    if (!trimmed || reviewRating === 0) return;

    const review: Review = {
      id: generateId(),
      author: reviewAuthor.trim() || "Anonymous",
      text: trimmed,
      rating: reviewRating,
      createdAt: Date.now(),
    };

    setReviews((prev) => [review, ...prev]);
    setReviewText("");
    setReviewAuthor("");
    setReviewRating(0);
    setShowReviewForm(false);
  }, [reviewText, reviewAuthor, reviewRating]);

  const handleTimestampClick = useCallback(
    (time: number) => {
      // Scroll to player using window.scrollTo for reliability across layouts
      const el = playerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const targetY =
          window.scrollY +
          rect.top -
          window.innerHeight / 2 +
          rect.height / 2;
        window.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
      }
      // Seek after a short delay to let scroll finish
      setTimeout(() => onSeekToTime(time), 400);
    },
    [playerRef, onSeekToTime]
  );

  const isWordHighlighted = useCallback(
    (index: number) => {
      if (dragSelection) {
        return index >= dragSelection.start && index <= dragSelection.end;
      }
      if (selectionRange) {
        return (
          index >= selectionRange.startIndex &&
          index <= selectionRange.endIndex
        );
      }
      return false;
    },
    [dragSelection, selectionRange]
  );

  // Highlighted ranges from feedback items
  const feedbackRanges = useMemo(() => {
    const map = new Map<number, string>();
    for (const fb of feedbacks) {
      for (let i = fb.startIndex; i <= fb.endIndex; i++) {
        map.set(i, fb.id);
      }
    }
    return map;
  }, [feedbacks]);

  return (
    <div className="space-y-4">
      {/* ─── Collapsible Transcript ──────────────────────────── */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50">
        <button
          onClick={() => setTranscriptOpen((o) => !o)}
          className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-neutral-800/30"
        >
          <span className="text-sm font-medium text-neutral-200">
            Transcript
          </span>
          <svg
            className={`h-4 w-4 text-neutral-500 transition-transform ${
              transcriptOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {transcriptOpen && (
          <div className="border-t border-neutral-800 px-6 pb-5 pt-4">
            <p className="mb-3 text-xs text-neutral-600">
              Click a word to jump to that point. Drag to select text and leave
              feedback.
            </p>
            <div
              ref={transcriptContainerRef}
              className="transcript-words max-h-[28rem] overflow-y-auto pr-2"
            >
              {chunks.length > 0 ? (
                <p className="select-none leading-relaxed text-neutral-200">
                  {chunks.map((chunk, index) => {
                    const isActive = index === activeWordIndex;
                    const isHighlighted = isWordHighlighted(index);
                    const hasFeedback = feedbackRanges.has(index);

                    return (
                      <span
                        key={`${chunk.start}-${chunk.end}-${index}`}
                        ref={isActive ? activeWordRef : null}
                        onMouseDown={(e) => handleWordMouseDown(index, e)}
                        onMouseEnter={() => handleWordMouseEnter(index)}
                        className={`cursor-pointer rounded px-0.5 transition-colors duration-150 ${
                          isHighlighted
                            ? "bg-blue-500/40 text-white"
                            : isActive
                              ? "bg-blue-500/30 text-white"
                              : hasFeedback
                                ? "bg-yellow-500/15 underline decoration-yellow-500/40 decoration-dotted underline-offset-4 hover:bg-yellow-500/25"
                                : "hover:bg-neutral-800"
                        }`}
                      >
                        {chunk.text}
                      </span>
                    );
                  })}
                </p>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed text-neutral-200">
                  {transcript}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Feedback Popover ────────────────────────────────── */}
      {popoverPos && selectionRange && (
        <FeedbackPopover
          position={popoverPos}
          selectedText={selectedText}
          onSubmit={handleFeedbackSubmit}
          onCancel={() => {
            setPopoverPos(null);
            setSelectionRange(null);
            setDragSelection(null);
          }}
        />
      )}

      {/* ─── Transcript Feedback Items ───────────────────────── */}
      {feedbacks.length > 0 && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
          <h3 className="mb-4 text-sm font-medium text-neutral-200">
            Transcript Feedback ({feedbacks.length})
          </h3>
          <div className="space-y-3">
            {feedbacks.map((fb) => (
              <div
                key={fb.id}
                className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="line-clamp-1 rounded bg-yellow-500/10 px-2 py-0.5 text-xs italic text-yellow-300/80">
                    &ldquo;{fb.selectedText}&rdquo;
                  </p>
                  <button
                    onClick={() => handleTimestampClick(fb.startTime)}
                    className="shrink-0 rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-mono text-blue-400 transition-colors hover:bg-neutral-700 hover:text-blue-300"
                  >
                    {formatTimestamp(fb.startTime)}
                  </button>
                </div>
                <p className="text-sm text-neutral-300">{fb.comment}</p>
                <p className="mt-2 text-xs text-neutral-600">
                  {fb.author} &middot;{" "}
                  {new Date(fb.createdAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Overall Reviews ─────────────────────────────────── */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-200">
            Reviews{reviews.length > 0 ? ` (${reviews.length})` : ""}
          </h3>
          {!showReviewForm && (
            <button
              onClick={() => setShowReviewForm(true)}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-700"
            >
              Add Review
            </button>
          )}
        </div>

        {showReviewForm && (
          <div className="mb-4 rounded-xl border border-neutral-700 bg-neutral-800/50 p-4">
            <div className="mb-3 flex items-center gap-3">
              <input
                value={reviewAuthor}
                onChange={(e) => setReviewAuthor(e.target.value)}
                placeholder="Your name (optional)"
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
              />
              <StarRating value={reviewRating} onChange={setReviewRating} />
            </div>
            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                  handleReviewSubmit();
              }}
              placeholder="Write your review..."
              rows={3}
              className="mb-3 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowReviewForm(false);
                  setReviewText("");
                  setReviewAuthor("");
                  setReviewRating(0);
                }}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReviewSubmit}
                disabled={!reviewText.trim() || reviewRating === 0}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-blue-500 disabled:opacity-40"
              >
                Submit Review
              </button>
            </div>
          </div>
        )}

        {reviews.length === 0 && !showReviewForm && (
          <p className="text-sm text-neutral-600">
            No reviews yet. Be the first to leave one.
          </p>
        )}

        {reviews.length > 0 && (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-300">
                    {r.author}
                  </span>
                  <StarRating value={r.rating} readonly />
                </div>
                <p className="text-sm text-neutral-300">{r.text}</p>
                <p className="mt-2 text-xs text-neutral-600">
                  {new Date(r.createdAt).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
