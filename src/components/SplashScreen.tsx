import { useEffect, useState } from "react";

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 400);
    const t2 = setTimeout(() => setPhase("out"), 2200);
    const t3 = setTimeout(() => onDone(), 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        opacity: phase === "out" ? 0 : 1,
        transition: phase === "in" ? "opacity 0.4s ease" : phase === "out" ? "opacity 0.5s ease" : "none",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* ── Animated aurora background ── */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {/* Slow-drifting main glow */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse 70% 60% at 50% 52%, rgba(109,40,217,0.45) 0%, transparent 70%)",
          animation: "splash-bg-breathe 4s ease-in-out infinite",
        }} />
        {/* Orbiting orb 1 — top-left */}
        <div style={{
          position: "absolute",
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.22) 0%, transparent 70%)",
          top: "-60px",
          left: "-80px",
          animation: "splash-orb-1 6s ease-in-out infinite",
        }} />
        {/* Orbiting orb 2 — bottom-right */}
        <div style={{
          position: "absolute",
          width: "260px",
          height: "260px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%)",
          bottom: "-40px",
          right: "-60px",
          animation: "splash-orb-2 7s ease-in-out infinite 1s",
        }} />
        {/* Orbiting orb 3 — mid */}
        <div style={{
          position: "absolute",
          width: "180px",
          height: "180px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(196,181,253,0.12) 0%, transparent 70%)",
          top: "30%",
          right: "8%",
          animation: "splash-orb-3 5.5s ease-in-out infinite 0.5s",
        }} />
        {/* Dot grid */}
        <div style={{
          position: "absolute",
          inset: 0,
          opacity: 0.06,
          backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)",
          backgroundSize: "32px 32px",
          animation: "splash-grid-drift 12s linear infinite",
        }} />
      </div>

      {/* ── Logo wrapper — pulsing ── */}
      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: phase === "hold" ? "aina-pulse 1.6s ease-in-out infinite" : "aina-pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}>
        {/* Outer glow ring */}
        <div style={{
          position: "absolute",
          width: "340px",
          height: "340px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.28) 0%, transparent 70%)",
          animation: phase === "hold" ? "aina-ring 1.6s ease-in-out infinite" : "none",
        }} />
        {/* Inner ring */}
        <div style={{
          position: "absolute",
          width: "250px",
          height: "250px",
          borderRadius: "50%",
          border: "1px solid rgba(139,92,246,0.35)",
          animation: phase === "hold" ? "aina-ring-inner 1.6s ease-in-out infinite 0.1s" : "none",
        }} />

        {/* Logo image */}
        <img
          src="/aigypt-logo.png"
          alt="AINA"
          style={{
            width: "200px",
            height: "200px",
            objectFit: "contain",
            filter: "drop-shadow(0 0 28px rgba(139,92,246,0.75)) drop-shadow(0 0 10px rgba(196,181,253,0.55)) brightness(1.15)",
            position: "relative",
            zIndex: 1,
          }}
        />
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes aina-pop-in {
          from { opacity: 0; transform: scale(0.55); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes aina-pulse {
          0%   { transform: scale(1);    filter: drop-shadow(0 0 0px rgba(139,92,246,0)); }
          45%  { transform: scale(1.08); filter: drop-shadow(0 0 28px rgba(139,92,246,0.9)); }
          55%  { transform: scale(1.08); filter: drop-shadow(0 0 28px rgba(139,92,246,0.9)); }
          100% { transform: scale(1);    filter: drop-shadow(0 0 0px rgba(139,92,246,0)); }
        }
        @keyframes aina-ring {
          0%   { transform: scale(0.82); opacity: 0; }
          45%  { transform: scale(1.12); opacity: 1; }
          55%  { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(0.82); opacity: 0; }
        }
        @keyframes aina-ring-inner {
          0%   { transform: scale(0.88); opacity: 0; }
          45%  { transform: scale(1.06); opacity: 0.7; }
          55%  { transform: scale(1.06); opacity: 0.7; }
          100% { transform: scale(0.88); opacity: 0; }
        }
        @keyframes splash-bg-breathe {
          0%   { opacity: 0.8; transform: scale(1) translate(0, 0); }
          33%  { opacity: 1;   transform: scale(1.08) translate(2%, -2%); }
          66%  { opacity: 0.9; transform: scale(1.04) translate(-2%, 2%); }
          100% { opacity: 0.8; transform: scale(1) translate(0, 0); }
        }
        @keyframes splash-orb-1 {
          0%   { transform: translate(0, 0) scale(1); opacity: 0.7; }
          50%  { transform: translate(40px, 50px) scale(1.2); opacity: 1; }
          100% { transform: translate(0, 0) scale(1); opacity: 0.7; }
        }
        @keyframes splash-orb-2 {
          0%   { transform: translate(0, 0) scale(1); opacity: 0.6; }
          50%  { transform: translate(-35px, -45px) scale(1.15); opacity: 0.9; }
          100% { transform: translate(0, 0) scale(1); opacity: 0.6; }
        }
        @keyframes splash-orb-3 {
          0%   { transform: translate(0, 0); opacity: 0.5; }
          50%  { transform: translate(-25px, 30px); opacity: 0.8; }
          100% { transform: translate(0, 0); opacity: 0.5; }
        }
        @keyframes splash-grid-drift {
          0%   { background-position: 0 0; }
          100% { background-position: 32px 32px; }
        }
      `}</style>
    </div>
  );
}
