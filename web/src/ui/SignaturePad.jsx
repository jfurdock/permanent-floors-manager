import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Finger or mouse signature. ref.current.toDataURL() returns a small PNG, or null if empty.
const SignaturePad = forwardRef(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#1b1f21';
    };
    resize();
    return undefined;
  }, []);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1f21';
    ctx.fill();
  };
  const move = (e) => {
    if (!drawing.current) return;
    const p = point(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) { setHasInk(true); onChange?.(true); }
  };
  const up = () => { drawing.current = false; };

  useImperativeHandle(ref, () => ({
    clear() {
      const c = canvasRef.current;
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      setHasInk(false);
      onChange?.(false);
    },
    isEmpty: () => !hasInk,
    toDataURL() {
      if (!hasInk) return null;
      const c = canvasRef.current;
      const scale = Math.min(1, 600 / c.width);
      const out = document.createElement('canvas');
      out.width = Math.round(c.width * scale);
      out.height = Math.round(c.height * scale);
      out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  }), [hasInk, onChange]);

  return (
    <div className="sig-pad">
      <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} aria-label="Signature area" role="img" />
      <div className="sig-line" />
      {!hasInk && <div className="sig-hint">Sign here with a finger or mouse</div>}
    </div>
  );
});

export default SignaturePad;
