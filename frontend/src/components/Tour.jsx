import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";

const STEPS = [
  {
    target: null,
    title: "Welcome to City Planner",
    body: "This tool helps city planners find optimal locations for new public infrastructure — toilets, benches, bike parking, and more — using walking-network gap scores and real deprivation data from Paris, Antwerp, and London.",
  },
  {
    target: ".header-selectors",
    title: "City & asset type",
    body: "Pick a city and the type of infrastructure to analyse. Scores and map update instantly.",
  },
  {
    target: ".leaflet-map",
    title: "Gap score map",
    body: "H3 cells are coloured by TES priority score — darker red means more underserved. Orange markers are the recommended new locations. Toggle any layer on or off in the panel.",
  },
  {
    target: ".control-panel",
    title: "Scenario panel",
    body: "Drag the slider to set how many new facilities to place. Coverage bars update in real time. Hit 'Generate Decision Report' to export findings.",
  },
  {
    target: ".mode-toggle",
    title: "Compare cities",
    body: "Switch to Compare view to see Paris, Antwerp, and London side by side — with density per km² and a normalisation note so the numbers are meaningful across contexts.",
  },
];

// a rect is unusable if it is missing, zero-size, or entirely off-screen
// (common on mobile where some step targets sit outside the viewport)
function isOffScreen(rect) {
  if (!rect) return true;
  return (
    rect.width === 0 ||
    rect.right <= 0 ||
    rect.left >= window.innerWidth ||
    rect.bottom <= 0 ||
    rect.top >= window.innerHeight
  );
}

function getRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  // treat off-screen/zero-size targets as no target → centered card, no ring
  return isOffScreen(rect) ? null : rect;
}

// z-index comes from the .tour-card class (var(--z-tour)); these only handle placement.
const CENTERED = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

function tooltipStyle(rect) {
  if (!rect) return CENTERED;
  const PAD = 16;
  const W = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // large element (fills most of viewport) — center the card over it
  if (rect.width > vw * 0.5 || rect.height > vh * 0.5) return CENTERED;

  // prefer below; if near bottom prefer above; if on right prefer left
  if (rect.bottom + 180 < vh) {
    return { position: "fixed", top: rect.bottom + PAD, left: Math.min(Math.max(rect.left, 12), vw - W - 12) };
  }
  if (rect.top - 180 > 0) {
    return { position: "fixed", bottom: vh - rect.top + PAD, left: Math.min(Math.max(rect.left, 12), vw - W - 12) };
  }
  if (rect.left > vw / 2) {
    return { position: "fixed", top: Math.min(rect.top, vh - 220), right: vw - rect.left + PAD };
  }
  return { position: "fixed", top: Math.min(rect.top, vh - 220), left: rect.right + PAD };
}

export default function Tour({ onDone }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const cardRef = useRef(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useLayoutEffect(() => {
    setRect(getRect(current.target));
  }, [step, current.target]);

  // capture the element focused before the tour opened; restore it on done
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // move focus into the card on each step
  useEffect(() => {
    cardRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const h = () => setRect(getRect(current.target));
    const onKey = (e) => {
      if (e.key === "Escape") return onDone();
      if (e.key === "ArrowRight") return next();
      if (e.key === "ArrowLeft") return prev();

      // focus trap: keep Tab within the tour card
      if (e.key === "Tab") {
        const card = cardRef.current;
        if (!card) return;
        const focusable = card.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeInCard = card.contains(document.activeElement);
        if (e.shiftKey) {
          if (document.activeElement === first || !activeInCard) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !activeInCard) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      // Enter advances, unless a button inside the card has focus
      // (let that button handle its own activation instead)
      if (e.key === "Enter") {
        const onButton = document.activeElement?.tagName === "BUTTON";
        if (!onButton) next();
      }
    };
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", h);
      window.removeEventListener("scroll", h, true);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.target, step]);

  const next = () => (isLast ? onDone() : setStep((s) => s + 1));
  const prev = () => setStep((s) => s - 1);

  return createPortal(
    <>
      {/* backdrop — when no target, full dark; with target, handled by ring shadow */}
      {!rect && <div className="tour-backdrop" onClick={onDone} />}

      {/* highlight ring with cut-out overlay effect */}
      {rect && (
        <div
          className="tour-ring"
          style={{
            top:    rect.top    - 5,
            left:   rect.left   - 5,
            width:  rect.width  + 10,
            height: rect.height + 10,
          }}
        />
      )}

      {/* tooltip card */}
      <div
        className="tour-card"
        ref={cardRef}
        tabIndex={-1}
        style={tooltipStyle(rect)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className="tour-step-badge">{step + 1} / {STEPS.length}</div>
        <h3 className="tour-title">{current.title}</h3>
        <p className="tour-body">{current.body}</p>
        <div className="tour-actions">
          {step > 0 && (
            <button className="tour-btn tour-btn--ghost" onClick={prev}>← Back</button>
          )}
          <button className="tour-btn tour-btn--ghost tour-skip" onClick={onDone}>Skip</button>
          <button className="tour-btn tour-btn--primary" onClick={next}>
            {isLast ? "Done" : "Next →"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
