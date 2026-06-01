import { useState, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";

const STEPS = [
  {
    target: null,
    title: "Welcome to Public Realm Planner",
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
    body: "H3 cells coloured by TES priority score. Orange markers = recommended new locations. Enable 'Score grid' in the panel to see which areas are underserved.",
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

function getRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  return el ? el.getBoundingClientRect() : null;
}

function tooltipStyle(rect) {
  if (!rect) {
    return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 10000 };
  }
  const PAD = 16;
  const W = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // prefer below; if near bottom prefer above; if on right prefer left
  if (rect.bottom + 180 < vh) {
    return { position: "fixed", top: rect.bottom + PAD, left: Math.min(Math.max(rect.left, 12), vw - W - 12), zIndex: 10000 };
  }
  if (rect.top - 180 > 0) {
    return { position: "fixed", bottom: vh - rect.top + PAD, left: Math.min(Math.max(rect.left, 12), vw - W - 12), zIndex: 10000 };
  }
  if (rect.left > vw / 2) {
    return { position: "fixed", top: Math.min(rect.top, vh - 220), right: vw - rect.left + PAD, zIndex: 10000 };
  }
  return { position: "fixed", top: Math.min(rect.top, vh - 220), left: rect.right + PAD, zIndex: 10000 };
}

export default function Tour({ onDone }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useLayoutEffect(() => {
    setRect(getRect(current.target));
  }, [step, current.target]);

  useEffect(() => {
    const h = () => setRect(getRect(current.target));
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [current.target]);

  const next = () => (isLast ? onDone() : setStep((s) => s + 1));
  const prev = () => setStep((s) => s - 1);

  return createPortal(
    <>
      {/* backdrop — when no target, full dark; with target, handled by ring shadow */}
      {!rect && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.72)", zIndex: 9998 }}
          onClick={onDone}
        />
      )}

      {/* highlight ring with cut-out overlay effect */}
      {rect && (
        <div
          style={{
            position: "fixed",
            top:    rect.top    - 5,
            left:   rect.left   - 5,
            width:  rect.width  + 10,
            height: rect.height + 10,
            borderRadius: 6,
            border: "2px solid #f97316",
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.65)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      )}

      {/* tooltip card */}
      <div className="tour-card" style={tooltipStyle(rect)} onClick={(e) => e.stopPropagation()}>
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
