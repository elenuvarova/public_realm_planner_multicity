/**
 * Shared status surfaces: Loader, ErrorState, EmptyState, Skeleton.
 * Centralised so loading / error / empty look identical everywhere.
 */

export function Spinner({ size = 28 }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Loader({ message = "Loading…", fill = false }) {
  return (
    <div className={`status status--loading ${fill ? "status--fill" : ""}`}>
      <Spinner />
      <p className="status-msg">{message}</p>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  fill = false,
}) {
  return (
    <div className={`status status--error ${fill ? "status--fill" : ""}`} role="alert">
      <div className="status-icon status-icon--error" aria-hidden="true">!</div>
      <p className="status-title">{title}</p>
      {message && <p className="status-msg">{message}</p>}
      {onRetry && (
        <button className="status-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title = "No data", message, fill = false }) {
  return (
    <div className={`status status--empty ${fill ? "status--fill" : ""}`}>
      <div className="status-icon" aria-hidden="true">—</div>
      <p className="status-title">{title}</p>
      {message && <p className="status-msg">{message}</p>}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="compare-card skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-line" style={{ width: "55%" }} />
      <div className="skeleton skeleton-block" style={{ height: 40, width: "70%" }} />
      <div className="skeleton skeleton-line" style={{ width: "100%" }} />
      <div className="skeleton skeleton-line" style={{ width: "100%" }} />
      <div className="skeleton skeleton-line" style={{ width: "40%" }} />
      <div className="skeleton-grid">
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" />
      </div>
    </div>
  );
}
