import { useState, useRef } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  Youtube, FileText, Rss, Send, ChevronLeft, Loader2,
  CheckCircle2, AlertCircle, ArrowRight, Upload, X, Hash,
  RefreshCw, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomNav } from "@/components/BottomNav";
import { getToken } from "@/lib/auth";

type Tab = "youtube" | "docx" | "rss" | "telegram";

interface KbResult {
  id: string;
  title: string;
  source_url: string;
  approval_status: string;
  scrape_status: string;
}

interface ScrapeResult {
  status: "ok" | "error";
  count?: number;
  articles?: KbResult[];
  article?: KbResult;
  error?: string;
}

const TAB_CONFIG: { id: Tab; label: string; icon: React.ReactNode; color: string; accent: string }[] = [
  { id: "youtube", label: "YouTube",  icon: <Youtube className="w-3.5 h-3.5" />,  color: "text-red-400",    accent: "bg-red-900/20 border-red-700/40" },
  { id: "docx",    label: "DOCX",     icon: <FileText className="w-3.5 h-3.5" />,  color: "text-blue-400",   accent: "bg-blue-900/20 border-blue-700/40" },
  { id: "rss",     label: "RSS Feed", icon: <Rss className="w-3.5 h-3.5" />,       color: "text-orange-400", accent: "bg-orange-900/20 border-orange-700/40" },
  { id: "telegram",label: "Telegram", icon: <Send className="w-3.5 h-3.5" />,      color: "text-sky-400",    accent: "bg-sky-900/20 border-sky-700/40" },
];

export default function MoreSourcesPage() {
  const [activeTab, setActiveTab] = useState<Tab>("youtube");

  // ── YouTube ──
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytResult, setYtResult] = useState<ScrapeResult | null>(null);

  // ── DOCX ──
  const [docxFiles, setDocxFiles] = useState<File[]>([]);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxResult, setDocxResult] = useState<ScrapeResult | null>(null);
  const [docxDrag, setDocxDrag] = useState(false);
  const docxRef = useRef<HTMLInputElement>(null);

  // ── RSS ──
  const [rssUrl, setRssUrl] = useState("");
  const [rssMax, setRssMax] = useState(10);
  const [rssLoading, setRssLoading] = useState(false);
  const [rssResult, setRssResult] = useState<ScrapeResult | null>(null);

  // ── Telegram ──
  const [tgChannel, setTgChannel] = useState("");
  const [tgLimit, setTgLimit] = useState(20);
  const [tgLoading, setTgLoading] = useState(false);
  const [tgResult, setTgResult] = useState<ScrapeResult | null>(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };

  const doYoutube = async () => {
    if (!ytUrl.trim()) return;
    setYtLoading(true); setYtResult(null);
    try {
      const res = await fetch(apiUrl("/api/youtube/scrape"), {
        method: "POST", headers,
        body: JSON.stringify({ url: ytUrl.trim() }),
      });
      setYtResult(await res.json());
    } catch { setYtResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setYtLoading(false);
  };

  const doDocx = async () => {
    if (docxFiles.length === 0) return;
    setDocxLoading(true); setDocxResult(null);
    try {
      const fd = new FormData();
      docxFiles.forEach(f => fd.append("files", f));
      const res = await fetch(apiUrl("/api/docx/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      setDocxResult(await res.json());
    } catch { setDocxResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setDocxLoading(false);
  };

  const doRss = async () => {
    if (!rssUrl.trim()) return;
    setRssLoading(true); setRssResult(null);
    try {
      const res = await fetch(apiUrl("/api/rss/fetch"), {
        method: "POST", headers,
        body: JSON.stringify({ url: rssUrl.trim(), max_items: rssMax }),
      });
      setRssResult(await res.json());
    } catch { setRssResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setRssLoading(false);
  };

  const doTelegram = async () => {
    if (!tgChannel.trim()) return;
    setTgLoading(true); setTgResult(null);
    try {
      const res = await fetch(apiUrl("/api/telegram/scrape"), {
        method: "POST", headers,
        body: JSON.stringify({ channel: tgChannel.trim(), limit: tgLimit }),
      });
      setTgResult(await res.json());
    } catch { setTgResult({ status: "error", error: "Gagal terhubung ke server." }); }
    setTgLoading(false);
  };

  const addDocxFiles = (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f =>
      f.name.toLowerCase().endsWith(".docx") || f.name.toLowerCase().endsWith(".doc")
    );
    setDocxFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  };

  function ResultBox({ result }: { result: ScrapeResult | null }) {
    if (!result) return null;
    const count = result.count ?? (result.article ? 1 : 0);
    return (
      <div className={`rounded-xl border p-3.5 space-y-2 ${
        result.status === "ok"
          ? "bg-emerald-900/15 border-emerald-700/30"
          : "bg-red-900/15 border-red-700/30"
      }`}>
        <div className="flex items-start gap-2">
          {result.status === "ok"
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            {result.status === "ok" ? (
              <p className="text-sm font-semibold text-emerald-300">
                {count} artikel berhasil disimpan ke KB Draft
              </p>
            ) : (
              <p className="text-sm font-semibold text-red-300">{result.error}</p>
            )}
          </div>
        </div>
        {result.status === "ok" && count > 0 && (
          <div className="space-y-1.5">
            {(result.articles ?? (result.article ? [result.article] : [])).slice(0, 5).map((a, i) => (
              <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg px-2.5 py-1.5">
                <Hash className="w-3 h-3 text-violet-400 shrink-0" />
                <p className="text-xs text-slate-300 truncate flex-1">{a.title || "(Tanpa Judul)"}</p>
                {a.source_url && (
                  <a href={a.source_url} target="_blank" rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 shrink-0">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
            {count > 5 && (
              <p className="text-xs text-slate-500 pl-2">...dan {count - 5} lainnya</p>
            )}
            <Link to="/review">
              <button className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 hover:bg-emerald-900/30 transition-colors">
                Buka Review Dashboard <ArrowRight className="w-3 h-3" />
              </button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  const tab = TAB_CONFIG.find(t => t.id === activeTab)!;

  return (
    <div className="flex flex-col bg-black text-white relative" style={{ minHeight: "100dvh" }}>

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden"
          style={{ opacity: 0.22, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block"
          style={{ opacity: 0.22 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 70% at 55% 40%, rgba(109,40,217,0.22) 0%, transparent 65%)" }} />
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle at 1.5px 1.5px, rgba(200,180,255,0.8) 1.5px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="absolute top-0 inset-x-0 h-28" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.82) 0%, transparent 100%)" }} />
        <div className="absolute bottom-0 inset-x-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)" }} />
      </div>

      <div className="relative z-10 flex flex-col flex-1">

        {/* Header */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-3 sm:py-4 flex items-center justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 px-2 lg:px-3 text-xs">
                <ChevronLeft className="w-3.5 h-3.5" /><span className="hidden sm:inline">Beranda</span>
              </Button>
            </Link>
            <div className="min-w-0 leading-none">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">Sumber Tambahan</p>
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />AINA
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px] lg:text-[13px]">YouTube · DOCX · RSS · Telegram</p>
            </div>
          </div>
          <Link to="/review">
            <Button variant="ghost" size="sm"
              className="gap-1 text-white/60 hover:text-white hover:bg-white/10 h-8 px-2 sm:px-3 text-xs rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" /><span className="hidden sm:inline text-xs">Review</span>
            </Button>
          </Link>
        </div>

        {/* Scrollable */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-24">
          <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">

            {/* Tab selector */}
            <div className="flex items-center gap-1 bg-[#0d0720] rounded-xl p-1 border border-violet-700/30 overflow-x-auto">
              {TAB_CONFIG.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 flex-1 justify-center text-xs px-2.5 py-2 rounded-lg font-semibold transition-all whitespace-nowrap ${
                    activeTab === t.id
                      ? "bg-violet-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-200 hover:bg-white/8"
                  }`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {/* ── YouTube Tab ── */}
            {activeTab === "youtube" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-red-600 via-red-400 to-red-600" />
                <div className="p-4 sm:p-5 space-y-4">

                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-900/40 border border-red-500/30 flex items-center justify-center shrink-0">
                      <Youtube className="w-4 h-4 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">YouTube Transcript</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Ambil transkrip dari video YouTube dan simpan sebagai KB Draft. Video harus punya subtitle/CC.</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">URL Video YouTube</label>
                    <div className="flex gap-2">
                      <Input
                        value={ytUrl}
                        onChange={e => setYtUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && doYoutube()}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="flex-1 h-9 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-red-400/40"
                      />
                      <Button onClick={doYoutube} disabled={ytLoading || !ytUrl.trim()}
                        className="h-9 px-4 bg-red-700 hover:bg-red-600 text-white text-xs rounded-xl shrink-0 disabled:opacity-50">
                        {ytLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Ambil"}
                      </Button>
                    </div>
                    {ytUrl.trim() && !ytLoading && !ytResult && (
                      <p className="text-[10px] text-slate-600">Pastikan video memiliki subtitle/CC (otomatis atau manual).</p>
                    )}
                  </div>

                  {ytLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 rounded-xl px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                      Mengambil transkrip YouTube...
                    </div>
                  )}
                  <ResultBox result={ytResult} />
                  {ytResult && (
                    <button onClick={() => { setYtUrl(""); setYtResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── DOCX Tab ── */}
            {activeTab === "docx" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-blue-600 via-blue-400 to-blue-600" />
                <div className="p-4 sm:p-5 space-y-4">

                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-900/40 border border-blue-500/30 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">Word / DOCX Parser</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Upload dokumen .docx atau .doc. Teks akan diekstrak dan disimpan sebagai KB Draft.</p>
                    </div>
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDocxDrag(true); }}
                    onDragLeave={() => setDocxDrag(false)}
                    onDrop={e => { e.preventDefault(); setDocxDrag(false); addDocxFiles(e.dataTransfer.files); }}
                    onClick={() => docxRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                      docxDrag
                        ? "border-blue-500/70 bg-blue-900/20"
                        : "border-blue-800/40 bg-blue-950/20 hover:border-blue-600/50 hover:bg-blue-900/15"
                    }`}>
                    <Upload className="w-5 h-5 text-blue-400" />
                    <p className="text-xs text-blue-300/70 font-medium">Drag & drop atau klik untuk pilih</p>
                    <p className="text-[10px] text-slate-600">.docx, .doc — bisa banyak file</p>
                    <input ref={docxRef} type="file" className="hidden" multiple accept=".docx,.doc"
                      onChange={e => addDocxFiles(e.target.files)} />
                  </div>

                  {/* File list */}
                  {docxFiles.length > 0 && (
                    <div className="space-y-1.5">
                      {docxFiles.map(f => (
                        <div key={f.name} className="flex items-center gap-2 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <p className="flex-1 text-xs text-slate-300 truncate">{f.name}</p>
                          <span className="text-[10px] text-slate-600 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                          <button onClick={() => setDocxFiles(prev => prev.filter(x => x.name !== f.name))}
                            className="text-slate-600 hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button onClick={doDocx} disabled={docxLoading}
                        className="w-full h-9 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded-xl disabled:opacity-50">
                        {docxLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Memproses...</> : `Proses ${docxFiles.length} File`}
                      </Button>
                    </div>
                  )}

                  {docxLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 rounded-xl px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                      Mengekstrak konten dokumen...
                    </div>
                  )}
                  <ResultBox result={docxResult} />
                  {docxResult && (
                    <button onClick={() => { setDocxFiles([]); setDocxResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── RSS Tab ── */}
            {activeTab === "rss" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-orange-600 via-orange-400 to-orange-600" />
                <div className="p-4 sm:p-5 space-y-4">

                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-orange-900/40 border border-orange-500/30 flex items-center justify-center shrink-0">
                      <Rss className="w-4 h-4 text-orange-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">RSS / Atom Feed</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Ambil artikel terbaru dari feed RSS/Atom sebuah situs. Setiap item jadi satu KB Draft.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">URL Feed RSS / Atom</label>
                      <Input
                        value={rssUrl}
                        onChange={e => setRssUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && doRss()}
                        placeholder="https://example.com/feed.xml"
                        className="h-9 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-orange-400/40"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Maks. Artikel</label>
                      <div className="flex items-center gap-3 bg-[#0f0a1e] border border-violet-800/40 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs text-slate-500 flex-1">Item per fetch</span>
                        <span className="text-sm font-bold text-orange-300 tabular-nums w-8 text-right">{rssMax}</span>
                        <input type="range" min={1} max={50} step={1} value={rssMax}
                          onChange={e => setRssMax(Number(e.target.value))}
                          className="w-28 accent-orange-500 cursor-pointer" />
                      </div>
                    </div>
                    <Button onClick={doRss} disabled={rssLoading || !rssUrl.trim()}
                      className="w-full h-9 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-xl disabled:opacity-50">
                      {rssLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Mengambil Feed...</> : "Fetch RSS Feed"}
                    </Button>
                  </div>

                  <ResultBox result={rssResult} />
                  {rssResult && (
                    <button onClick={() => { setRssUrl(""); setRssResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Telegram Tab ── */}
            {activeTab === "telegram" && (
              <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                <div className="h-[3px] bg-gradient-to-r from-sky-600 via-sky-400 to-sky-600" />
                <div className="p-4 sm:p-5 space-y-4">

                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-sky-900/40 border border-sky-500/30 flex items-center justify-center shrink-0">
                      <Send className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">Telegram Channel Scraper</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Scrape postingan dari channel Telegram publik. Masukkan username channel (tanpa @).</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-[11px] text-sky-300 bg-sky-900/20 border border-sky-700/30 rounded-xl px-3 py-2.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Hanya bekerja untuk <strong>channel publik</strong>. Channel privat tidak bisa diakses.</span>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Username Channel</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">@</span>
                        <Input
                          value={tgChannel}
                          onChange={e => setTgChannel(e.target.value.replace(/^@/, ""))}
                          onKeyDown={e => e.key === "Enter" && doTelegram()}
                          placeholder="kemlu_ri"
                          className="h-9 pl-7 text-xs bg-[#0f0a1e] border-violet-800/40 text-slate-200 rounded-xl placeholder:text-slate-600 focus-visible:ring-sky-400/40"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Maks. Postingan</label>
                      <div className="flex items-center gap-3 bg-[#0f0a1e] border border-violet-800/40 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs text-slate-500 flex-1">Postingan per fetch</span>
                        <span className="text-sm font-bold text-sky-300 tabular-nums w-8 text-right">{tgLimit}</span>
                        <input type="range" min={5} max={100} step={5} value={tgLimit}
                          onChange={e => setTgLimit(Number(e.target.value))}
                          className="w-28 accent-sky-500 cursor-pointer" />
                      </div>
                    </div>
                    <Button onClick={doTelegram} disabled={tgLoading || !tgChannel.trim()}
                      className="w-full h-9 bg-sky-700 hover:bg-sky-600 text-white text-xs rounded-xl disabled:opacity-50">
                      {tgLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Scraping Channel...</> : "Scrape Channel"}
                    </Button>
                  </div>

                  {tgLoading && (
                    <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 rounded-xl px-3 py-2.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                      Mengambil postingan dari t.me/{tgChannel}...
                    </div>
                  )}
                  <ResultBox result={tgResult} />
                  {tgResult && (
                    <button onClick={() => { setTgChannel(""); setTgResult(null); }}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                      <RefreshCw className="w-3 h-3" />Reset
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <BottomNav active="home" />
    </div>
  );
}
