import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import {
  Newspaper, BookOpen, ArrowRight, ClipboardCheck,
  CheckCircle2, Clock, Send, AlertCircle, Zap,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  exported: number;
}

export default function HomePage() {
  const [stats, setStats] = useState<Stats | null>(null);

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
    <div className="min-h-screen bg-black relative overflow-hidden flex flex-col">

      {/* ── Background layer ── */}
      <div className="absolute inset-0 pointer-events-none select-none">
        {/* Background image — purple glowing arc */}
        <img
          src="/bg-home.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center animate-glow-pulse"
          style={{ mixBlendMode: "screen", opacity: 0.85 }}
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
        {/* Dark vignette at bottom so cards stay readable */}
        <div className="absolute bottom-0 inset-x-0 h-1/2"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)" }} />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col flex-1 px-3 sm:px-6 pb-16 pt-5 sm:pt-10">

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

          {/* Title — Sunspire font (split words to avoid space-char rendering as box) */}
          <div
            className="flex items-baseline gap-[0.25em] leading-none"
            style={{
              fontFamily: "'Sunspire', cursive",
              fontSize: "clamp(1.6rem, 10vw, 3.75rem)",
            }}
          >
            <span style={{
              background: "linear-gradient(135deg, #ffffff 0%, #d8b4fe 55%, #a78bfa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.02em",
            }}>AINA</span>
            <span style={{
              background: "linear-gradient(135deg, #e9d5ff 0%, #c084fc 50%, #a855f7 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              letterSpacing: "0.02em",
            }}>Scraper</span>
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

            {/* Berita card */}
            <Link to="/scraper" className="group relative rounded-xl sm:rounded-2xl overflow-hidden" style={{ padding: "1px" }}>
              <div className="absolute inset-0 rounded-xl sm:rounded-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.6) 0%, rgba(139,92,246,0.3) 100%)" }} />
              <div className="relative rounded-xl sm:rounded-2xl p-3 sm:p-5 h-full flex flex-col"
                style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)", backdropFilter: "blur(16px)" }}>

                <div className="relative w-8 h-8 sm:w-10 sm:h-10 mb-2 sm:mb-3">
                  <div className="absolute inset-0 bg-blue-500/30 rounded-lg sm:rounded-xl blur-md group-hover:bg-blue-500/50 transition-colors duration-300" />
                  <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
                    <Newspaper className="w-4 h-4 sm:w-5 sm:h-5 text-blue-300" strokeWidth={1.8} />
                  </div>
                </div>

                <h3 className="font-bold text-white text-xs leading-tight mb-1 sm:hidden">Berita Kemlu</h3>
                <h3 className="font-bold text-white text-base leading-tight mb-2 hidden sm:block">Berita Kemlu / KBRI</h3>
                <p className="text-purple-300/55 text-[10px] sm:text-xs leading-relaxed flex-1 hidden sm:block">
                  Scrape artikel dari portal resmi. Masukkan URL, pilih mode, dan jalankan.
                </p>
                <p className="text-purple-300/55 text-[10px] leading-relaxed flex-1 sm:hidden">
                  Portal berita resmi
                </p>

                <div className="flex items-center justify-between mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-white/5">
                  <span className="text-[9px] sm:text-[10px] font-bold text-blue-400/70 uppercase tracking-widest hidden sm:block">Portal Resmi</span>
                  <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold text-blue-400 group-hover:text-blue-300 transition-colors ml-auto">
                    Mulai <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            </Link>

            {/* PDF card */}
            <Link to="/pdf" className="group relative rounded-xl sm:rounded-2xl overflow-hidden" style={{ padding: "1px" }}>
              <div className="absolute inset-0 rounded-xl sm:rounded-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.6) 0%, rgba(168,85,247,0.3) 100%)" }} />
              <div className="relative rounded-xl sm:rounded-2xl p-3 sm:p-5 h-full flex flex-col"
                style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)", backdropFilter: "blur(16px)" }}>

                <div className="relative w-8 h-8 sm:w-10 sm:h-10 mb-2 sm:mb-3">
                  <div className="absolute inset-0 bg-violet-500/30 rounded-lg sm:rounded-xl blur-md group-hover:bg-violet-500/50 transition-colors duration-300" />
                  <div className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-violet-500/20 border border-violet-400/30 flex items-center justify-center">
                    <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-violet-300" strokeWidth={1.8} />
                  </div>
                </div>

                <h3 className="font-bold text-white text-xs sm:text-base leading-tight mb-1 sm:mb-2">Kitab PDF Arab</h3>
                <p className="text-purple-300/55 text-[10px] sm:text-xs leading-relaxed flex-1 hidden sm:block">
                  Upload kitab PDF berbahasa Arab. Teks diekstrak, di-chunk, dan disimpan sebagai KB Draft.
                </p>
                <p className="text-purple-300/55 text-[10px] leading-relaxed flex-1 sm:hidden">
                  OCR kitab Arab
                </p>

                <div className="flex items-center justify-between mt-2 sm:mt-4 pt-2 sm:pt-3 border-t border-white/5">
                  <span className="text-[9px] sm:text-[10px] font-bold text-violet-400/70 uppercase tracking-widest hidden sm:block">Kitab Arab · OCR</span>
                  <div className="flex items-center gap-0.5 text-[10px] sm:text-xs font-semibold text-violet-400 group-hover:text-violet-300 transition-colors ml-auto">
                    Upload <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
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
            className="group relative rounded-xl sm:rounded-2xl overflow-hidden block"
            style={{ padding: "1px" }}
          >
            <div className={`absolute inset-0 rounded-xl sm:rounded-2xl transition-opacity duration-300 ${hasPending ? "opacity-80 group-hover:opacity-100" : hasApproved ? "opacity-70 group-hover:opacity-100" : "opacity-30 group-hover:opacity-60"}`}
              style={{ background: hasPending
                ? "linear-gradient(135deg, rgba(245,158,11,0.6) 0%, rgba(217,119,6,0.3) 100%)"
                : hasApproved
                ? "linear-gradient(135deg, rgba(16,185,129,0.6) 0%, rgba(5,150,105,0.3) 100%)"
                : "linear-gradient(135deg, rgba(99,102,241,0.4) 0%, rgba(139,92,246,0.2) 100%)"
              }} />

            <div className="relative rounded-xl sm:rounded-2xl p-3 sm:p-5"
              style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)", backdropFilter: "blur(16px)" }}>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative w-9 h-9 sm:w-12 sm:h-12 shrink-0">
                    <div className={`absolute inset-0 rounded-lg sm:rounded-xl blur-lg transition-colors duration-300 ${hasPending ? "bg-amber-500/30" : hasApproved ? "bg-emerald-500/30" : "bg-indigo-500/20"}`} />
                    <div className={`relative w-9 h-9 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl border flex items-center justify-center ${hasPending ? "bg-amber-500/20 border-amber-400/30" : hasApproved ? "bg-emerald-500/20 border-emerald-400/30" : "bg-indigo-500/10 border-indigo-400/20"}`}>
                      <ClipboardCheck className={`w-4 h-4 sm:w-6 sm:h-6 ${hasPending ? "text-amber-300" : hasApproved ? "text-emerald-300" : "text-indigo-400"}`} strokeWidth={1.8} />
                    </div>
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

      </div>

      {/* ── Bottom Nav — override dark style ── */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-white/10"
        style={{ background: "rgba(5,1,15,0.92)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center justify-around h-14 px-4 max-w-screen-2xl mx-auto">
          <div className="flex flex-col items-center gap-0.5 px-8 py-1.5 rounded-xl min-w-[80px]"
            style={{ background: "linear-gradient(135deg, rgba(109,40,217,0.5) 0%, rgba(91,33,182,0.3) 100%)", border: "1px solid rgba(139,92,246,0.4)" }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(196,181,253,1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span className="text-[10px] font-semibold text-violet-300">Beranda</span>
          </div>
          <Link to="/review" className="relative flex flex-col items-center gap-0.5 px-8 py-1.5 rounded-xl min-w-[80px] text-purple-500/60 hover:text-purple-400 transition-colors">
            {(stats?.pending ?? 0) > 0 && (
              <span className="absolute -top-1 right-2 bg-amber-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {(stats?.pending ?? 0) > 99 ? "99+" : stats!.pending}
              </span>
            )}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            <span className="text-[10px] font-semibold">Review</span>
          </Link>
        </div>
      </div>

    </div>
  );
}
