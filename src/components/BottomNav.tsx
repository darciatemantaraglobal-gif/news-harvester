import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";

type ActivePage = "home" | "scraper" | "pdf" | "review";

interface BottomNavProps {
  active: ActivePage;
}

const HomeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const ReviewIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
);

const ACTIVE_STYLE = {
  background: "linear-gradient(135deg, rgba(109,40,217,0.55) 0%, rgba(79,20,180,0.35) 100%)",
  border: "1px solid rgba(167,139,250,0.35)",
} as React.CSSProperties;

export function BottomNav({ active }: BottomNavProps) {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch(apiUrl("/api/kb-draft"), { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.articles) {
          const pending = data.articles.filter(
            (a: { approval_status: string }) => a.approval_status === "pending"
          ).length;
          setPendingCount(pending);
        }
      })
      .catch(() => {});
  }, []);

  const isHome = active === "home";
  const isReview = active === "review";

  return (
    <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-6 pointer-events-none">
      <div
        className="flex items-center gap-1 px-2 py-2 rounded-2xl pointer-events-auto"
        style={{
          background: "rgba(8,3,20,0.88)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(139,92,246,0.35)",
          boxShadow: "0 0 24px rgba(109,40,217,0.25), 0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        {/* Beranda */}
        <Link
          to="/"
          className="flex items-center gap-2 px-5 py-2 rounded-xl transition-all duration-200"
          style={isHome ? ACTIVE_STYLE : undefined}
        >
          <span style={{ color: isHome ? "rgba(221,214,254,1)" : "rgba(139,92,246,0.7)" }}
            className={!isHome ? "hover:text-violet-300 transition-colors duration-200" : ""}>
            <HomeIcon />
          </span>
          <span className={`text-[11px] font-semibold tracking-wide ${isHome ? "text-violet-200" : "text-violet-500/70"}`}>
            Beranda
          </span>
        </Link>

        {/* Divider */}
        <div className="w-px h-6 bg-violet-800/50 mx-1" />

        {/* Review */}
        <Link
          to="/review"
          className="relative flex items-center gap-2 px-5 py-2 rounded-xl transition-all duration-200 hover:bg-white/5"
          style={isReview ? ACTIVE_STYLE : undefined}
        >
          {pendingCount > 0 && (
            <span className="absolute -top-1.5 right-3 bg-amber-500 text-white text-[8px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1 shadow-lg">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
          <span style={{ color: isReview ? "rgba(221,214,254,1)" : "rgba(139,92,246,0.7)" }}>
            <ReviewIcon />
          </span>
          <span className={`text-[11px] font-semibold tracking-wide ${isReview ? "text-violet-200" : "text-violet-500/70"}`}>
            Review
          </span>
        </Link>
      </div>
    </div>
  );
}
