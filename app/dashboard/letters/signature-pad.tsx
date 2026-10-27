"use client";

import { useEffect, useRef, useState } from "react";
import { prepareSignatureCanvas } from "./signature-image";

/** A box to sign in with a finger, pen or mouse. "Use this drawing" hands back a cleaned-up PNG. */
export default function SignaturePad({ onUse, onCancel }: { onUse: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3.2;
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current?.getContext("2d");
    // A tap leaves a dot.
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
    }
    setInked(true);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = point(e);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  }

  function up() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setInked(false);
    setError(null);
  }

  function use() {
    const c = canvasRef.current;
    if (!c) return;
    try {
      onUse(prepareSignatureCanvas(c));
    } catch (e: any) {
      setError(e.message || "Could not use that drawing");
    }
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={900}
        height={300}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Signature drawing box"
        style={{ width: "100%", maxWidth: 560, aspectRatio: "3 / 1", border: "1px dashed var(--border, #bbb)", borderRadius: 6, background: "#fff", touchAction: "none", cursor: "crosshair" }}
      />
      {error && <p className="error-text" style={{ margin: "0.4rem 0 0" }}>{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={use} disabled={!inked}>
          Use this drawing
        </button>
        <button type="button" className="btn btn-secondary" onClick={clear}>
          Clear
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
