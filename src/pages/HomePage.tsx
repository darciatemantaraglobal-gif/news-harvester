import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@/lib/api";
import {
  Newspaper, BookOpen, ChevronRight, ClipboardCheck,
  CheckCircle2, Clock, Send, AlertCircle,
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
    <div className="flex flex-col min-h-screen bg-[#f0f1f8] text-slate-900">

      {/* ─── Header ─── */}
      <div className="mx-3 sm:mx-6 mt-4 sm:mt-6 bg-gradient-to-r from-[#1a0533] via-[#2e0d5e] to-[#3d1480] rounded-2xl px-6 py-5 shadow-lg shadow-purple-900/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-white font-black text-lg">A</span>
          </div>
          <div>
            <p className="font-bold text-white text-xl tracking-tight">AINA Scraper</p>
            <p className="text-purple-300 text-xs mt-0.5">Internal Knowledge Scraping Tool</p>
          </div>
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 px-3 sm:px-6 pt-5 pb-24 space-y-5">

        {/* ── Step 1: Pilih Sumber ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <p className="text-sm font-bold text-slate-700">Tambah konten baru</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Berita card */}
            <Link to="/scraper" className="group bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-start gap-4 hover:border-indigo-200 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0 group-hover:bg-indigo-200 transition-colors">
                <Newspaper className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-sm">Berita Kemlu / KBRI</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Scrape artikel dari portal resmi Kemlu dan KBRI. Masukkan URL halaman berita, pilih mode, dan jalankan.
                </p>
                <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-indigo-600">
                  Mulai scraping <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>

            {/* PDF card */}
            <Link to="/pdf" className="group bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-start gap-4 hover:border-violet-200 hover:shadow-md transition-all">
              <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center shrink-0 group-hover:bg-violet-200 transition-colors">
                <BookOpen className="w-6 h-6 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-sm">Kitab PDF Arab</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Upload PDF kitab berbahasa Arab. Teks diekstrak otomatis, chunk per N halaman, dan disimpan sebagai KB Draft.
                </p>
                <div className="flex items-center gap-1 mt-3 text-xs font-semibold text-violet-600">
                  Upload PDF <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* ── Step 2: Review & Push ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 ${hasPending || hasApproved ? "bg-indigo-600" : "bg-slate-300"}`}>2</span>
            <p className="text-sm font-bold text-slate-700">Review & kirim ke Supabase</p>
          </div>

          <Link to="/review" className={`block bg-white rounded-2xl shadow-sm border p-5 hover:shadow-md transition-all ${
            hasPending
              ? "border-amber-200 hover:border-amber-300"
              : hasApproved
              ? "border-emerald-200 hover:border-emerald-300"
              : "border-slate-100 hover:border-slate-200"
          }`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  hasPending ? "bg-amber-100" : hasApproved ? "bg-emerald-100" : "bg-slate-100"
                }`}>
                  <ClipboardCheck className={`w-6 h-6 ${
                    hasPending ? "text-amber-600" : hasApproved ? "text-emerald-600" : "text-slate-400"
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 text-sm">KB Review Dashboard</p>
                  {stats === null ? (
                    <p className="text-xs text-slate-400 mt-1">Memuat status...</p>
                  ) : stats.total === 0 ? (
                    <p className="text-xs text-slate-400 mt-1">Belum ada KB Draft. Mulai dari Langkah 1.</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      {stats.pending > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" />{stats.pending} pending
                        </span>
                      )}
                      {stats.approved > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />{stats.approved} siap push
                        </span>
                      )}
                      {stats.rejected > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                          <AlertCircle className="w-3 h-3" />{stats.rejected} rejected
                        </span>
                      )}
                      {stats.exported > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          <Send className="w-3 h-3" />{stats.exported} exported
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
            </div>

            {hasPending && (
              <div className="mt-4 pt-4 border-t border-amber-100 flex items-center justify-between">
                <p className="text-xs text-amber-700 font-medium">
                  Ada <strong>{stats!.pending}</strong> artikel menunggu review sebelum bisa dikirim ke Supabase.
                </p>
                <span className="text-xs font-bold text-amber-600 flex items-center gap-1">
                  Buka Review <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
            )}
            {!hasPending && hasApproved && (
              <div className="mt-4 pt-4 border-t border-emerald-100 flex items-center justify-between">
                <p className="text-xs text-emerald-700 font-medium">
                  <strong>{stats!.approved}</strong> artikel sudah diapprove, siap di-push ke Supabase.
                </p>
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  Push sekarang <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
        )}
          </Link>
        </div>

        {/* ── About ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Tentang Tool</p>
          <div className="space-y-2 text-xs text-slate-500 leading-relaxed">
            <p>AINA Scraper adalah tool internal untuk mengumpulkan konten dari <strong className="text-slate-700">portal resmi Kemlu/KBRI</strong> dan <strong className="text-slate-700">kitab PDF Arab</strong>, lalu mengonversinya menjadi KB Draft terstruktur.</p>
            <p>Semua artikel melewati proses <strong className="text-slate-700">review & approval</strong> sebelum dikirim ke Supabase dan dikonsumsi oleh AINA AI Assistant.</p>
          </div>
        </div>

      </div>

      <BottomNav active="home" />
    </div>
  );
}
