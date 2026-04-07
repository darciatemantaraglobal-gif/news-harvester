import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import {
  Newspaper, BookOpen, ArrowRight, ClipboardCheck,
  CheckCircle2, Clock, Send, AlertCircle, Zap, Users, LogOut, ClipboardPaste,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { clearToken, getIsAdmin, getUsername } from "@/lib/auth";

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  exported: number;
}

export default function HomePage() {
  const navigate = useNavigate();
  const isAdmin = getIsAdmin();
  const username = getUsername();
  const [stats, setStats] = useState<Stats | null>(null);

  const handleLogout = () => {
    clearToken();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    fetch(apiUrl("/api/kb-draft"), { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.articles) return;
        const articles: { approval_status: string }[] = data.articles;
        setStats({
          total: articles.length,
          pending: articles.filter(a => a.approval_status === "pending").length,
          approved: articles.filter(a => a.approval_status === "approved").length,
          rejected: articles.filter(a => a.approval_status === "rejected").length,
          exported: articles.filter(a => a.approval_status === "exported").length,
        });
      })
      .catch(() => {});
  }, []);

  const hasPending = (stats?.pending ?? 0) > 0;
  const hasApproved = (stats?.approved ?? 0) > 0;

  return (
    <div className="bg-black relative overflow-hidden flex flex-col" style={{ minHeight: '100dvh' }}>

      {/* ── Background layer ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        {/* Background image — purple marble sphere */}
        <img
          src="/bg-home.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover animate-glow-pulse sm:hidden"
          style={{ opacity: 0.9, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }}
        />
        <img
          src="/bg-desktop.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover animate-glow-pulse hidden sm:block"
          style={{ opacity: 0.9 }}
        />
        {/* Extra animated overlay glow for depth */}
        <div
          className="absolute inset-0 animate-glow-drift"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 60% 45%, rgba(109,40,217,0.35) 0%, rgba(79,20,180,0.15) 50%, transparent 80%)",
          }}
        />
        {/* Subtle dot grid on top */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: `radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.9) 1.5px, transparent 0)`,
          backgroundSize: "36px 36px",
        }} />
        {/* Dark vignette top (title area) */}
        <div className="absolute top-0 inset-x-0 h-1/3"
          style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)" }} />
        {/* Dark vignette bottom (cards area) */}
        <div className="absolute bottom-0 inset-x-0 h-2/3"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }} />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col flex-1 overflow-hidden">

      {/* ─── MOBILE layout (< sm) ─── */}
      <div className="sm:hidden flex flex-col flex-1 overflow-y-auto pb-20 px-3 items-center justify-center">
      <div className="w-full max-w-[380px] mx-auto flex flex-col gap-0">

        {/* ── User bar ── */}
        <div className="flex items-center justify-between mb-3 sm:mb-5 px-0.5">
          <span className="text-[11px] text-violet-400/60 font-medium">
            {username ? <>Halo, <span className="text-violet-300 font-bold">{username}</span></> : ""}
          </span>
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <Link to="/users">
                <button className="flex items-center gap-1 text-[10px] font-bold text-violet-400 hover:text-violet-200 bg-violet-900/30 hover:bg-violet-800/40 border border-violet-700/40 px-2.5 py-1 rounded-full transition-all">
                  <Users className="w-3 h-3" /><span className="hidden sm:inline">Kelola Akun</span><span className="sm:hidden">Akun</span>
                </button>
              </Link>
            )}
            <button onClick={handleLogout}
              className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1 rounded-full transition-all">
              <LogOut className="w-3 h-3" /><span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>

        {/* ── Hero ── */}
        <div className="flex flex-col items-center text-center mb-4 sm:mb-10">
          {/* Logo */}
          <div className="relative mb-2 sm:mb-5">
            <div className="absolute inset-0 scale-[2.5] bg-violet-500/20 rounded-full blur-2xl pointer-events-none" />
            <img
              src="/AIGYPT_logo.png"
              alt="AINA"
              className="relative w-10 h-10 sm:w-20 sm:h-20 object-contain"
              style={{ filter: "brightness(0) invert(1) drop-shadow(0 0 12px rgba(200,160,255,1))" }}
            />
          </div>

          {/* Title — Sunspire font, stacked top/bottom */}
          <div
            className="flex flex-col items-center leading-none"
            style={{ fontFamily: "'Sunspire', cursive", letterSpacing: "0.04em" }}
          >
            <span
              style={{
                fontSize: "clamp(2.8rem, 16vw, 6rem)",
                background: "linear-gradient(135deg, #ffffff 0%, #e9d5ff 60%, #c084fc 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                lineHeight: 1.05,
              }}
            >AINA</span>
            <span
              style={{
                fontSize: "clamp(2.3rem, 13vw, 5rem)",
                background: "linear-gradient(135deg, #ddd6fe 0%, #a855f7 50%, #7c3aed 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                lineHeight: 1.05,
              }}
            >Scraper</span>
          </div>
          <p className="mt-1 sm:mt-2 text-purple-400/60 text-[10px] sm:text-sm font-medium tracking-wide">
            Internal Knowledge Scraping Tool
          </p>

          {/* Flow badge */}
          <div className="mt-2 sm:mt-5 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-2.5 sm:px-4 py-1">
            <Zap className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-violet-400 shrink-0" />
            <span className="text-[9px] sm:text-[11px] text-violet-300 font-semibold tracking-wider uppercase whitespace-nowrap">
              Pilih sumber · Review · Kirim ke Supabase
            </span>
          </div>
        </div>

        {/* ── Step 1: Source cards — always 2 col ── */}
        <div className="mb-3 sm:mb-4">
          <div className="flex items-center gap-3 mb-2 px-0.5">
            <span className="text-[9px] sm:text-[10px] font-bold text-violet-500 uppercase tracking-[0.15em]">Langkah 1</span>
            <div className="flex-1 h-px bg-gradient-to-r from-violet-800/60 to-transparent" />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3">

            {/* Berita card — solid + rotating border beam */}
            <Link to="/scraper" className="group relative overflow-hidden rounded-xl sm:rounded-2xl transition-all duration-300 hover:scale-[1.02]"
              style={{ background: "#0d0720" }}>
              <div className="absolute animate-border-beam pointer-events-none"
                style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
              <div className="relative m-px rounded-[11px] sm:rounded-[15px] flex flex-col p-3 sm:p-5 h-full" style={{ background: "#0d0720" }}>
                <div className="w-8 h-8 sm:w-10 sm:h-10 mb-2 sm:mb-3 rounded-lg sm:rounded-xl bg-violet-900/60 border border-violet-500/40 flex items-center justify-center">
                  <Newspaper className="w-4 h-4 sm:w-5 sm:h-5 text-violet-300" strokeWidth={1.8} />
                </div>
                <h3 className="font-bold text-white text-xs leading-tight mb-1 sm:hidden">Scraper Berita</h3>
                <h3 className="font-bold text-white text-base leading-tight mb-2 hidden sm:block">Scraper Berita Web</h3>
                <p className="text-violet-300/50 text-[10px] sm:text-xs leading-relaxed flex-1 hidden sm:block">
                  Scrape artikel dari website berita manapun. Masukkan URL, pilih mode, dan jalankan.
                </p>
                <p className="text-violet-300/50 text-[10px] leading-relaxed flex-1 sm:hidden">Portal berita resmi</p>
                <div className="flex items-center justify-between mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-violet-800/40">
                  <span className="text-[9px] sm:text-[10px] font-bold text-violet-500/70 uppercase tracking-widest hidden sm:block">Web / Portal Berita</span>
                  <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold text-violet-400 group-hover:text-violet-200 transition-colors ml-auto">
                    Mulai <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>

            {/* PDF card — solid + rotating border beam (offset phase) */}
            <Link to="/pdf" className="group relative overflow-hidden rounded-xl sm:rounded-2xl transition-all duration-300 hover:scale-[1.02]"
              style={{ background: "#0d0720" }}>
              <div className="absolute animate-border-beam-delay pointer-events-none"
                style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
              <div className="relative m-px rounded-[11px] sm:rounded-[15px] flex flex-col p-3 sm:p-5 h-full" style={{ background: "#0d0720" }}>
                <div className="w-8 h-8 sm:w-10 sm:h-10 mb-2 sm:mb-3 rounded-lg sm:rounded-xl bg-violet-900/60 border border-violet-500/40 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-violet-300" strokeWidth={1.8} />
                </div>
                <h3 className="font-bold text-white text-xs sm:text-base leading-tight mb-1 sm:mb-2">Kitab PDF Arab</h3>
                <p className="text-violet-300/50 text-[10px] sm:text-xs leading-relaxed flex-1 hidden sm:block">
                  Upload kitab PDF berbahasa Arab. Teks diekstrak, di-chunk, dan disimpan sebagai KB Draft.
                </p>
                <p className="text-violet-300/50 text-[10px] leading-relaxed flex-1 sm:hidden">OCR kitab Arab</p>
                <div className="flex items-center justify-between mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-violet-800/40">
                  <span className="text-[9px] sm:text-[10px] font-bold text-violet-500/70 uppercase tracking-widest hidden sm:block">Kitab Arab · OCR</span>
                  <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold text-violet-400 group-hover:text-violet-200 transition-colors ml-auto">
                    Upload <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>

          {/* Paste card — full width */}
            <Link to="/paste" className="group relative overflow-hidden rounded-xl sm:rounded-2xl transition-all duration-300 hover:scale-[1.01] col-span-2"
              style={{ background: "#0d0720" }}>
              <div className="absolute animate-border-beam-slow pointer-events-none"
                style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(99,102,241,0.5) 300deg, rgba(165,180,252,0.9) 345deg, transparent 360deg)" }} />
              <div className="relative m-px rounded-[11px] sm:rounded-[15px] flex items-center gap-3 p-3 sm:p-4" style={{ background: "#0d0720" }}>
                <div className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-lg sm:rounded-xl bg-indigo-900/60 border border-indigo-500/40 flex items-center justify-center">
                  <ClipboardPaste className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-300" strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-white text-xs sm:text-sm leading-tight">Paste & Rapikan Artikel</h3>
                  <p className="text-indigo-300/50 text-[10px] sm:text-xs leading-relaxed mt-0.5">Tempel konten artikel, AI langsung rapikan jadi Markdown presisi.</p>
                </div>
                <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold text-indigo-400 group-hover:text-indigo-200 transition-colors shrink-0">
                  Paste <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>

          </div>
        </div>

        {/* ── Step 2: Review card ── */}
        <div>
          <div className="flex items-center gap-3 mb-2 px-0.5">
            <span className="text-[9px] sm:text-[10px] font-bold text-violet-500 uppercase tracking-[0.15em]">Langkah 2</span>
            <div className="flex-1 h-px bg-gradient-to-r from-violet-800/60 to-transparent" />
          </div>

          <Link
            to="/review"
            className="group relative overflow-hidden rounded-xl sm:rounded-2xl block transition-all duration-300 hover:scale-[1.01]"
            style={{ background: "#0d0720" }}
          >
            <div className="absolute animate-border-beam-slow pointer-events-none"
              style={{
                inset: "-50%", width: "200%", height: "200%",
                background: hasPending
                  ? "conic-gradient(transparent 260deg, rgba(217,119,6,0.6) 300deg, rgba(252,211,77,1) 345deg, transparent 360deg)"
                  : hasApproved
                  ? "conic-gradient(transparent 260deg, rgba(5,150,105,0.6) 300deg, rgba(110,231,183,1) 345deg, transparent 360deg)"
                  : "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)",
              }} />
            <div className="relative m-px rounded-[11px] sm:rounded-[15px] p-3 sm:p-5" style={{ background: "#0d0720" }}>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-9 h-9 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl border flex items-center justify-center ${hasPending ? "bg-amber-950/60 border-amber-500/50" : hasApproved ? "bg-emerald-950/60 border-emerald-500/50" : "bg-violet-950/60 border-violet-500/40"}`}>
                    <ClipboardCheck className={`w-4 h-4 sm:w-6 sm:h-6 ${hasPending ? "text-amber-300" : hasApproved ? "text-emerald-300" : "text-violet-400"}`} strokeWidth={1.8} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-white text-xs sm:text-sm">KB Review Dashboard</p>

                    {stats === null ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                        <span className="text-[10px] text-purple-400">Memuat status...</span>
                      </div>
                    ) : stats.total === 0 ? (
                      <p className="text-[10px] text-purple-400/70 mt-0.5">Belum ada KB Draft</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {stats.pending > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                            <Clock className="w-2.5 h-2.5" />{stats.pending} pending
                          </span>
                        )}
                        {stats.approved > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 rounded-full">
                            <CheckCircle2 className="w-2.5 h-2.5" />{stats.approved} siap push
                          </span>
                        )}
                        {stats.rejected > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-red-300 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full">
                            <AlertCircle className="w-2.5 h-2.5" />{stats.rejected} rejected
                          </span>
                        )}
                        {stats.exported > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 bg-white/10 border border-white/10 px-1.5 py-0.5 rounded-full">
                            <Send className="w-2.5 h-2.5" />{stats.exported} exported
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-white/20 shrink-0 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
              </div>

              {/* CTA strip */}
              {hasPending && (
                <div className="mt-2 sm:mt-4 pt-2 sm:pt-4 border-t border-amber-500/20 flex items-center justify-between">
                  <p className="text-[10px] text-amber-300/80">
                    <strong className="text-amber-300">{stats!.pending}</strong> artikel menunggu review
                  </p>
                  <span className="text-[10px] font-bold text-amber-400 group-hover:text-amber-300 flex items-center gap-0.5 transition-colors">
                    Buka Review <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              )}
              {!hasPending && hasApproved && (
                <div className="mt-2 sm:mt-4 pt-2 sm:pt-4 border-t border-emerald-500/20 flex items-center justify-between">
                  <p className="text-[10px] text-emerald-300/80">
                    <strong className="text-emerald-300">{stats!.approved}</strong> siap di-push ke Supabase
                  </p>
                  <span className="text-[10px] font-bold text-emerald-400 group-hover:text-emerald-300 flex items-center gap-0.5 transition-colors">
                    Push <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              )}
            </div>
          </Link>
        </div>

      </div>{/* end mobile max-w wrapper */}
      </div>{/* end mobile layout */}

      {/* ─── DESKTOP layout (≥ sm) ─── */}
      <div className="hidden sm:flex flex-col flex-1 overflow-hidden">

        {/* Top strip: user bar */}
        <div className="flex items-center justify-between px-8 lg:px-14 pt-4 pb-2 shrink-0">
          <span className="text-xs text-violet-400/60 font-medium">
            {username ? <>Halo, <span className="text-violet-300 font-bold">{username}</span></> : ""}
          </span>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/users">
                <button className="flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-200 bg-violet-900/30 hover:bg-violet-800/40 border border-violet-700/40 px-3 py-1.5 rounded-full transition-all">
                  <Users className="w-3.5 h-3.5" />Kelola Akun
                </button>
              </Link>
            )}
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-all">
              <LogOut className="w-3.5 h-3.5" />Keluar
            </button>
          </div>
        </div>

        {/* Main 2-col area */}
        <div className="flex flex-1 items-center gap-10 lg:gap-16 px-8 lg:px-12 max-w-6xl mx-auto w-full overflow-hidden pb-16">

          {/* Left: Hero */}
          <div className="flex flex-col items-center text-center shrink-0 w-72 lg:w-[22rem]">
            <div className="relative mb-4">
              <div className="absolute inset-0 scale-[2.6] bg-violet-500/22 rounded-full blur-2xl pointer-events-none" />
              <img src="/AIGYPT_logo.png" alt="AINA" className="relative w-[4.5rem] h-[4.5rem] lg:w-24 lg:h-24 object-contain"
                style={{ filter: "brightness(0) invert(1) drop-shadow(0 0 14px rgba(200,160,255,1))" }} />
            </div>
            <div className="flex flex-col items-center leading-none mb-3" style={{ fontFamily: "'Sunspire', cursive", letterSpacing: "0.04em" }}>
              <span style={{ fontSize: "clamp(2.6rem, 4.2vw, 4.5rem)", background: "linear-gradient(135deg, #ffffff 0%, #e9d5ff 60%, #c084fc 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.05 }}>AINA</span>
              <span style={{ fontSize: "clamp(2.1rem, 3.4vw, 3.6rem)", background: "linear-gradient(135deg, #ddd6fe 0%, #a855f7 50%, #7c3aed 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.05 }}>Scraper</span>
            </div>
            <p className="text-purple-400/60 text-xs font-medium tracking-wide mb-4">Internal Knowledge Scraping Tool</p>
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-full px-4 py-1.5">
              <Zap className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-[11px] text-violet-300 font-semibold tracking-wider uppercase whitespace-nowrap">Pilih sumber · Review · Kirim ke Supabase</span>
            </div>
          </div>

          {/* Right: Action cards */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">

            {/* Step 1 label */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-violet-500 uppercase tracking-[0.15em]">Langkah 1</span>
              <div className="flex-1 h-px bg-gradient-to-r from-violet-800/60 to-transparent" />
            </div>

            {/* Step 1 cards */}
            <div className="grid grid-cols-2 gap-3">
              <Link to="/scraper" className="group relative overflow-hidden rounded-2xl transition-all duration-300 hover:scale-[1.02]" style={{ background: "#0d0720" }}>
                <div className="absolute animate-border-beam pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[15px] flex flex-col p-5 h-full" style={{ background: "#0d0720" }}>
                  <div className="w-11 h-11 mb-3 rounded-xl bg-violet-900/60 border border-violet-500/40 flex items-center justify-center">
                    <Newspaper className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
                  </div>
                  <h3 className="font-bold text-white text-base leading-tight mb-2">Scraper Berita Web</h3>
                  <p className="text-violet-300/50 text-xs leading-relaxed flex-1">Scrape artikel dari website berita manapun. Masukkan URL, pilih mode, dan jalankan.</p>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-violet-800/40">
                    <span className="text-[10px] font-bold text-violet-500/70 uppercase tracking-widest">Web / Portal Berita</span>
                    <div className="flex items-center gap-0.5 text-xs font-semibold text-violet-400 group-hover:text-violet-200 transition-colors">Mulai <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" /></div>
                  </div>
                </div>
              </Link>
              <Link to="/pdf" className="group relative overflow-hidden rounded-2xl transition-all duration-300 hover:scale-[1.02]" style={{ background: "#0d0720" }}>
                <div className="absolute animate-border-beam-delay pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[15px] flex flex-col p-5 h-full" style={{ background: "#0d0720" }}>
                  <div className="w-11 h-11 mb-3 rounded-xl bg-violet-900/60 border border-violet-500/40 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
                  </div>
                  <h3 className="font-bold text-white text-base leading-tight mb-2">Kitab PDF Arab</h3>
                  <p className="text-violet-300/50 text-xs leading-relaxed flex-1">Upload kitab PDF berbahasa Arab. Teks diekstrak, di-chunk, dan disimpan sebagai KB Draft.</p>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-violet-800/40">
                    <span className="text-[10px] font-bold text-violet-500/70 uppercase tracking-widest">Kitab Arab · OCR</span>
                    <div className="flex items-center gap-0.5 text-xs font-semibold text-violet-400 group-hover:text-violet-200 transition-colors">Upload <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" /></div>
                  </div>
                </div>
              </Link>

              {/* Paste card — full width desktop */}
              <Link to="/paste" className="group relative overflow-hidden rounded-2xl col-span-2 transition-all duration-300 hover:scale-[1.01]" style={{ background: "#0d0720" }}>
                <div className="absolute animate-border-beam-slow pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(99,102,241,0.5) 300deg, rgba(165,180,252,0.9) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[15px] flex items-center gap-4 p-4" style={{ background: "#0d0720" }}>
                  <div className="w-11 h-11 shrink-0 rounded-xl bg-indigo-900/60 border border-indigo-500/40 flex items-center justify-center">
                    <ClipboardPaste className="w-5 h-5 text-indigo-300" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white text-base leading-tight">Paste & Rapikan Artikel</h3>
                    <p className="text-indigo-300/50 text-xs leading-relaxed mt-1">Tempel konten artikel dari sumber manapun. AI akan menyaring info penting dan memformatnya jadi Markdown yang rapi dan presisi.</p>
                  </div>
                  <div className="flex items-center gap-0.5 text-xs font-semibold text-indigo-400 group-hover:text-indigo-200 transition-colors shrink-0">
                    Paste <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </Link>
            </div>

            {/* Step 2 label */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-violet-500 uppercase tracking-[0.15em]">Langkah 2</span>
              <div className="flex-1 h-px bg-gradient-to-r from-violet-800/60 to-transparent" />
            </div>

            {/* Review card */}
            <Link to="/review" className="group relative overflow-hidden rounded-2xl block transition-all duration-300 hover:scale-[1.01]" style={{ background: "#0d0720" }}>
              <div className="absolute animate-border-beam-slow pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: hasPending ? "conic-gradient(transparent 260deg, rgba(217,119,6,0.6) 300deg, rgba(252,211,77,1) 345deg, transparent 360deg)" : hasApproved ? "conic-gradient(transparent 260deg, rgba(5,150,105,0.6) 300deg, rgba(110,231,183,1) 345deg, transparent 360deg)" : "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
              <div className="relative m-px rounded-[15px] p-5" style={{ background: "#0d0720" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-12 h-12 shrink-0 rounded-xl border flex items-center justify-center ${hasPending ? "bg-amber-950/60 border-amber-500/50" : hasApproved ? "bg-emerald-950/60 border-emerald-500/50" : "bg-violet-950/60 border-violet-500/40"}`}>
                      <ClipboardCheck className={`w-6 h-6 ${hasPending ? "text-amber-300" : hasApproved ? "text-emerald-300" : "text-violet-400"}`} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white text-base">KB Review Dashboard</p>
                      {stats === null ? (
                        <div className="flex items-center gap-1.5 mt-1"><div className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /><span className="text-[10px] text-purple-400">Memuat status...</span></div>
                      ) : stats.total === 0 ? (
                        <p className="text-[10px] text-purple-400/70 mt-0.5">Belum ada KB Draft</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {stats.pending > 0 && <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 rounded-full"><Clock className="w-2.5 h-2.5" />{stats.pending} pending</span>}
                          {stats.approved > 0 && <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 rounded-full"><CheckCircle2 className="w-2.5 h-2.5" />{stats.approved} siap push</span>}
                          {stats.rejected > 0 && <span className="flex items-center gap-1 text-[10px] font-semibold text-red-300 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full"><AlertCircle className="w-2.5 h-2.5" />{stats.rejected} rejected</span>}
                          {stats.exported > 0 && <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-300 bg-white/10 border border-white/10 px-1.5 py-0.5 rounded-full"><Send className="w-2.5 h-2.5" />{stats.exported} exported</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-white/20 shrink-0 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                </div>
                {hasPending && (
                  <div className="mt-4 pt-4 border-t border-amber-500/20 flex items-center justify-between">
                    <p className="text-[10px] text-amber-300/80"><strong className="text-amber-300">{stats!.pending}</strong> artikel menunggu review</p>
                    <span className="text-[10px] font-bold text-amber-400 group-hover:text-amber-300 flex items-center gap-0.5 transition-colors">Buka Review <ArrowRight className="w-2.5 h-2.5" /></span>
                  </div>
                )}
                {!hasPending && hasApproved && (
                  <div className="mt-4 pt-4 border-t border-emerald-500/20 flex items-center justify-between">
                    <p className="text-[10px] text-emerald-300/80"><strong className="text-emerald-300">{stats!.approved}</strong> siap di-push ke Supabase</p>
                    <span className="text-[10px] font-bold text-emerald-400 group-hover:text-emerald-300 flex items-center gap-0.5 transition-colors">Push <ArrowRight className="w-2.5 h-2.5" /></span>
                  </div>
                )}
              </div>
            </Link>

          </div>{/* end right col */}
        </div>{/* end 2-col */}
      </div>{/* end desktop layout */}

      </div>{/* end outer content wrapper */}

      {/* ── Bottom Nav — elegant floating pill ── */}
      <div className="fixed bottom-4 inset-x-0 z-30 flex justify-center px-6">
        <div
          className="flex items-center gap-1 px-2 py-2 rounded-2xl"
          style={{
            background: "rgba(8,3,20,0.88)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(139,92,246,0.35)",
            boxShadow: "0 0 24px rgba(109,40,217,0.25), 0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          {/* Beranda — active */}
          <div className="flex items-center gap-2 px-5 py-2 rounded-xl"
            style={{ background: "linear-gradient(135deg, rgba(109,40,217,0.55) 0%, rgba(79,20,180,0.35) 100%)", border: "1px solid rgba(167,139,250,0.35)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(221,214,254,1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span className="text-[11px] font-semibold text-violet-200 tracking-wide">Beranda</span>
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-violet-800/50 mx-1" />

          {/* Review */}
          <Link to="/review" className="relative flex items-center gap-2 px-5 py-2 rounded-xl text-violet-500/70 hover:text-violet-300 transition-all duration-200 hover:bg-white/5">
            {(stats?.pending ?? 0) > 0 && (
              <span className="absolute -top-1.5 right-3 bg-amber-500 text-white text-[8px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1 shadow-lg">
                {(stats?.pending ?? 0) > 99 ? "99+" : stats!.pending}
              </span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span className="text-[11px] font-semibold tracking-wide">Review</span>
          </Link>
        </div>
      </div>

    </div>
  );
}
