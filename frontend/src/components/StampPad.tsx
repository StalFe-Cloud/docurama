import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface StampPadProps {
  /** Called with a PNG data URL whenever the drawing changes, or null once cleared. */
  onChange: (dataUrl: string | null) => void;
  height?: number;
  label?: string;
}

/**
 * A real drawing surface for saved signature and initials stamps.
 *
 * The settings modals previously showed a decorative panel captioned "draw your
 * signature in the pad below" with no canvas behind it, and a Save button that
 * reported success and stored nothing. This produces an actual PNG.
 *
 * Kept deliberately small. The signing studio has a richer pad with stroke smoothing
 * for the act of signing itself; a stored stamp only needs to capture the mark.
 */
export const StampPad: React.FC<StampPadProps> = ({ onChange, height = 160, label }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Transparent background, so a stamp composites cleanly onto a document rather
    // than covering it with a white rectangle.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a';
  }, []);

  const pointFrom = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    // The canvas is laid out responsively, so its backing store and its rendered size
    // differ; scale or the ink lands away from the pointer.
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };

  const stop = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasInk) onChange(canvas.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-xs font-semibold text-[#37352f]">{label}</label>}
      <div className="relative rounded-md bg-white border border-[#e5e3df] shadow-inner">
        <canvas
          ref={canvasRef}
          width={480}
          height={height}
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={stop}
          className="w-full cursor-crosshair touch-none"
          style={{ height }}
        />
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 bottom-2 px-2 py-1 rounded-md bg-[#f6f5f4] hover:bg-[#ede9e4] text-[#37352f] text-[10px] font-bold flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>
      {!hasInk && (
        <p className="text-[11px] text-[#787671]">Draw above, or upload an image instead.</p>
      )}
    </div>
  );
};
