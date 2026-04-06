import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Home, ClipboardCheck } from "lucide-react";
import { apiUrl } from "@/lib/api";

type ActivePage = "home" | "scraper" | "pdf" | "review";

interface BottomNavProps {
  active: ActivePage;
}

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

  const navItem = (
    to: string,
    isActive: boolean,
    icon: React.ReactNode,
    label: string,
    badge?: number
  ) => (
    <Link
      to={to}
      className={`relative flex flex-col items-center gap-0.5 px-8 py-1.5 rounded-xl transition-colors min-w-[80px] ${
        isActive
          ? "bg-slate-900 text-white"
          : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
      }`}
    >
      {badge != null && badge > 0 && (
        <span className="absolute -top-1 right-2.5 bg-amber-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {icon}
      <span className="text-[10px] font-semibold">{label}</span>
    </Link>
  );

  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-around h-14 px-4 max-w-screen-2xl mx-auto">
        {navItem("/", active === "home", <Home size={18} />, "Beranda")}
        {navItem("/review", active === "review", <ClipboardCheck size={18} />, "Review", pendingCount)}
      </div>
    </nav>
  );
}
