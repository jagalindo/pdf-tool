// ─── Google Analytics 4 (gtag) ────────────────────────────
// Measurement ID is injected at build time via VITE_GA_ID env var.
// If the var is empty or absent, all tracking calls are no-ops.

declare function gtag(...args: unknown[]): void;

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;
const enabled = !!GA_ID;

export function initAnalytics(): void {
  if (!enabled) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  (window as any).dataLayer = (window as any).dataLayer ?? [];
  (window as any).gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    (window as any).dataLayer.push(arguments);
  };

  gtag("js", new Date());
  gtag("config", GA_ID, {
    // Don't send full URLs — only the hash fragment matters here
    page_path: location.hash || "/",
    // Respect privacy: don't send IP addresses
    anonymize_ip: true,
  });
}

/** Call when the user navigates to a new "virtual page" (tool or home). */
export function trackPageView(path: string, title: string): void {
  if (!enabled) return;
  gtag("event", "page_view", { page_path: path, page_title: title });
}

/** Call when the user selects a tool from the home screen. */
export function trackToolSelected(toolId: string, toolTitle: string): void {
  if (!enabled) return;
  gtag("event", "tool_selected", { tool_id: toolId, tool_title: toolTitle });
}

/** Call just before the engine worker is sent a job. */
export function trackJobStarted(toolId: string, inputSizeBytes: number): void {
  if (!enabled) return;
  gtag("event", "job_started", {
    tool_id: toolId,
    input_size_kb: Math.round(inputSizeBytes / 1024),
  });
}

/** Call when a job completes successfully. */
export function trackJobCompleted(
  toolId: string,
  inputSizeBytes: number,
  outputSizeBytes: number,
  durationMs: number
): void {
  if (!enabled) return;
  gtag("event", "job_completed", {
    tool_id: toolId,
    input_size_kb: Math.round(inputSizeBytes / 1024),
    output_size_kb: Math.round(outputSizeBytes / 1024),
    duration_ms: Math.round(durationMs),
  });
}

/** Call when a job fails. */
export function trackJobError(toolId: string, errorMessage: string): void {
  if (!enabled) return;
  gtag("event", "job_error", {
    tool_id: toolId,
    error_message: errorMessage.slice(0, 100),
  });
}

/** Call when the user changes the UI language. */
export function trackLanguageChange(lang: string): void {
  if (!enabled) return;
  gtag("event", "language_change", { language: lang });
}

/** Call when the user toggles the theme. */
export function trackThemeChange(theme: string): void {
  if (!enabled) return;
  gtag("event", "theme_change", { theme });
}
