import { useEffect, useRef, useState } from "react";

/**
 * The "working on it" screen.
 *
 * The elapsed counter is the point of this component. A conversion runs about
 * 15ms per KB of LaTeX, so a full textbook can sit here for ten seconds or
 * more with nothing to show — and a bare spinner is not evidence of progress,
 * since `animate-spin` is a CSS transform that keeps rotating on the
 * compositor even when the main thread is wedged. A ticking numeral only
 * advances if the UI thread is genuinely free, which it is exactly because the
 * pipeline runs in a worker.
 */

/** Seconds since mount, ticking once a second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  // Wall-clock delta rather than a counter: an interval that misses ticks
  // (background tab, a busy frame) would otherwise under-report the wait.
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return seconds;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface ProcessingPanelProps {
  message?: string;
  /** Omitted when the work cannot be interrupted (e.g. a host write). */
  onCancel?: () => void;
}

export function ProcessingPanel({
  message = "Processing your file…",
  onCancel,
}: ProcessingPanelProps) {
  const elapsed = useElapsedSeconds();

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-slate-600"
      role="status"
      aria-live="polite"
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-700 border-t-transparent" />
      <p className="text-sm">{message}</p>
      {/* tabular-nums stops the line jittering as the digits change. */}
      <p className="text-xs tabular-nums text-slate-500">
        {formatElapsed(elapsed)}
      </p>
      {elapsed >= 10 ? (
        <p className="max-w-xs text-center text-xs text-slate-500">
          Large documents can take a while. You can keep working in other tabs.
        </p>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-2 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      ) : null}
    </div>
  );
}
