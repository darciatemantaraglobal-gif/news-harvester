import { useEffect, useState } from "react";

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 400);
    const t2 = setTimeout(() => setPhase("out"), 2000);
    const t3 = setTimeout(() => onDone(), 2500);
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
      }}
    >
      {/* Background glow */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse 60% 50% at 50% 55%, rgba(109,40,217,0.35) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Logo wrapper — pulsing */}
      <div style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: "28px",
        animation: phase === "hold" ? "aina-pulse 1.6s ease-in-out infinite" : "aina-pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
      }}>
        {/* Outer glow ring */}
        <div style={{
          position: "absolute",
          width: "160px",
          height: "160px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)",
          animation: phase === "hold" ? "aina-ring 1.6s ease-in-out infinite" : "none",
        }} />
        {/* Inner ring */}
        <div style={{
          position: "absolute",
          width: "118px",
          height: "118px",
          borderRadius: "50%",
          border: "1px solid rgba(139,92,246,0.35)",
          animation: phase === "hold" ? "aina-ring-inner 1.6s ease-in-out infinite 0.1s" : "none",
        }} />

        {/* Logo image */}
        <img
          src="/aigypt-logo.png"
          alt="AINA"
          style={{
            width: "90px",
            height: "90px",
            objectFit: "contain",
            filter: "drop-shadow(0 0 18px rgba(139,92,246,0.7)) drop-shadow(0 0 6px rgba(196,181,253,0.5)) brightness(1.15)",
            position: "relative",
            zIndex: 1,
          }}
        />
      </div>

      {/* App name */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        animation: phase === "hold" ? "none" : "aina-text-in 0.5s ease 0.2s forwards",
        opacity: phase === "in" ? 0 : 1,
      }}>
        <span style={{
          fontFamily: "'Sk-Modernist-Bold', 'Segoe UI', sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.35em",
          color: "rgba(196,181,253,0.7)",
          textTransform: "uppercase",
        }}>
          AINA
        </span>
        <span style={{
          fontFamily: "'Sk-Modernist-Bold', 'Segoe UI', sans-serif",
          fontSize: "26px",
          fontWeight: 800,
          letterSpacing: "0.12em",
          color: "#ffffff",
          textTransform: "uppercase",
          lineHeight: 1.1,
        }}>
          SCRAPER
        </span>
        <span style={{
          fontSize: "10px",
          letterSpacing: "0.2em",
          color: "rgba(139,92,246,0.6)",
          marginTop: "4px",
          textTransform: "uppercase",
        }}>
          Internal Access Only
        </span>
      </div>

      {/* Keyframes injected via style tag */}
      <style>{`
        @keyframes aina-pop-in {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes aina-text-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes aina-pulse {
          0%   { transform: scale(1);    filter: drop-shadow(0 0 0px rgba(139,92,246,0)); }
          45%  { transform: scale(1.10); filter: drop-shadow(0 0 22px rgba(139,92,246,0.9)); }
          55%  { transform: scale(1.10); filter: drop-shadow(0 0 22px rgba(139,92,246,0.9)); }
          100% { transform: scale(1);    filter: drop-shadow(0 0 0px rgba(139,92,246,0)); }
        }
        @keyframes aina-ring {
          0%   { transform: scale(0.85); opacity: 0; }
          45%  { transform: scale(1.15); opacity: 1; }
          55%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.85); opacity: 0; }
        }
        @keyframes aina-ring-inner {
          0%   { transform: scale(0.9);  opacity: 0; }
          45%  { transform: scale(1.08); opacity: 0.7; }
          55%  { transform: scale(1.08); opacity: 0.7; }
          100% { transform: scale(0.9);  opacity: 0; }
        }
      `}</style>
    </div>
  );
}
