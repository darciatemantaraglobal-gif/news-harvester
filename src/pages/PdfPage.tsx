import { useState, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  FileText, Upload, Loader2, ChevronLeft, CheckCircle2,
  AlertCircle, BookOpen, CheckSquare, X,
  Sparkles, Info, ScanLine, Layers, DollarSign, ChevronDown, Wand2,
  Search, ChevronUp, Hash, Image, AlignLeft, ListCollapse,
  GraduationCap, Brain, Tag, Globe, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";

interface UploadResult {
  filename: string;
  status: "ok" | "error";
  title?: string;
  total_pages?: number;
  text_pages?: number;
  scan_pages?: number;
  ocr_pages_done?: number;
  chunks?: number;
  error?: string | null;
}

interface PdfPageInfo {
  page: number;
  type: "text" | "scan" | "unknown";
  heading: string | null;
  heading_type?: string;
  preview: string;
  words: number;
}

interface PdfChapter {
  page: number;
  heading: string;
  type: string;
}

interface PdfInspectResult {
  filename: string;
  title: string;
  author: string;
  subject: string;
  total_pages: number;
  text_pages: number;
  scan_pages: number;
  chapters: PdfChapter[];
  pages: PdfPageInfo[];
}

interface PdfLearnChapter {
  nomor: number;
  judul: string;
  halaman: number;
  pembahasan: string;
}

interface PdfLearnResult {
  title: string;
  author: string;
  language: string;
  field: string;
  total_pages: number;
  text_pages: number;
  scan_pages: number;
  ai_available: boolean;
  overview: string;
  chapters: PdfLearnChapter[];
  topics: string[];
}

const CATEGORIES = [
  "Fiqh", "Aqidah", "Akhlak", "Hadits", "Tafsir",
  "Sirah", "Nahwu / Sharaf", "Bahasa Arab", "Umum",
];

const COST_PER_SCAN_PAGE_USD = 0.0002;

function formatCost(pages: number): string {
  const usd = pages * COST_PER_SCAN_PAGE_USD;
  if (usd < 0.01) return `<$0.01`;
  return `~$${usd.toFixed(2)}`;
}

export default function PdfPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rapikanState, setRapikanState] = useState<Record<string, { loading: boolean; done: boolean; error: string; updated?: number }>>({});

  const [category, setCategory] = useState("");
  const [chunkSize, setChunkSize] = useState(20);
  const [useOcr, setUseOcr] = useState(false);
  const [maxOcrPages, setMaxOcrPages] = useState(150);

  // ── Inspect state ──
  const [inspectMap, setInspectMap] = useState<Record<string, PdfInspectResult>>({});
  const [inspectLoadingMap, setInspectLoadingMap] = useState<Record<string, boolean>>({});
  const [inspectErrorMap, setInspectErrorMap] = useState<Record<string, string>>({});
  const [inspectOpenMap, setInspectOpenMap] = useState<Record<string, boolean>>({});
  const [showAllPagesMap, setShowAllPagesMap] = useState<Record<string, boolean>>({});

  // ── Pelajari PDF (AI Learn) state ──
  const [learnMap, setLearnMap] = useState<Record<string, PdfLearnResult>>({});
  const [learnLoadingMap, setLearnLoadingMap] = useState<Record<string, boolean>>({});
  const [learnErrorMap, setLearnErrorMap] = useState<Record<string, string>>({});
  const [learnOpenMap, setLearnOpenMap] = useState<Record<string, boolean>>({});
  // Page range — berlaku untuk semua file dalam batch
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(0); // 0 = semua halaman

  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...pdfs.filter(f => !names.has(f.name))];
    });
  };

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name));
    setInspectMap(prev => { const n = { ...prev }; delete n[name]; return n; });
    setInspectOpenMap(prev => { const n = { ...prev }; delete n[name]; return n; });
  };

  const handleInspect = async (file: File) => {
    const name = file.name;
    setInspectLoadingMap(prev => ({ ...prev, [name]: true }));
    setInspectErrorMap(prev => ({ ...prev, [name]: "" }));
    setInspectOpenMap(prev => ({ ...prev, [name]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/pdf/inspect"), { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal inspeksi");
      setInspectMap(prev => ({ ...prev, [name]: data as PdfInspectResult }));
      // Set default page range dari hasil inspect
      setPageStart(1);
      setPageEnd(data.total_pages);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Terjadi kesalahan";
      setInspectErrorMap(prev => ({ ...prev, [name]: msg }));
    }
    setInspectLoadingMap(prev => ({ ...prev, [name]: false }));
  };

  const handleLearn = async (file: File) => {
    const name = file.name;
    setLearnLoadingMap(prev => ({ ...prev, [name]: true }));
    setLearnErrorMap(prev => ({ ...prev, [name]: "" }));
    setLearnOpenMap(prev => ({ ...prev, [name]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(apiUrl("/api/pdf/learn"), { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal analisis");
      setLearnMap(prev => ({ ...prev, [name]: data as PdfLearnResult }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Terjadi kesalahan";
      setLearnErrorMap(prev => ({ ...prev, [name]: msg }));
    }
    setLearnLoadingMap(prev => ({ ...prev, [name]: false }));
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  const handleRapikanFile = async (filename: string) => {
    setRapikanState(prev => ({ ...prev, [filename]: { loading: true, done: false, error: "" } }));
    try {
      const res = await fetch(apiUrl("/api/pdf/rapikan-file"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal");
      setRapikanState(prev => ({ ...prev, [filename]: { loading: false, done: true, error: "", updated: data.updated } }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Terjadi kesalahan";
      setRapikanState(prev => ({ ...prev, [filename]: { loading: false, done: false, error: msg } }));
    }
  };

  const doUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setResults([]);
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    fd.append("category", category);
    fd.append("chunk_size", String(chunkSize));
    fd.append("use_ocr", useOcr ? "true" : "false");
    fd.append("max_ocr_pages", String(maxOcrPages));
    fd.append("page_start", String(pageStart));
    fd.append("page_end", String(pageEnd));

    try {
      const res = await fetch(apiUrl("/api/pdf/upload"), { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setResults(data.results || []);
        if ((data.processed ?? 0) > 0) setFiles([]);
      } else {
        setResults([{ filename: "—", status: "error", error: data.error || "Upload gagal" }]);
      }
    } catch {
      setResults([{ filename: "—", status: "error", error: "Gagal terhubung ke backend." }]);
    }
    setUploading(false);
  };

  const okResults = results.filter(r => r.status === "ok");
  const totalChunks = okResults.reduce((sum, r) => sum + (r.chunks ?? 0), 0);
  const totalOcrDone = okResults.reduce((sum, r) => sum + (r.ocr_pages_done ?? 0), 0);
  const estimatedCost = formatCost(maxOcrPages * files.length);

  return (
    <div className="flex flex-col bg-black text-white relative sm:overflow-hidden" style={{ minHeight: '100dvh' }}>

      {/* ── Background ── */}
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

        {/* ─── Header ─── */}
        <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-3 sm:py-4 lg:py-5 flex items-center justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #1a0535 0%, #2f0c60 40%, #4a1890 100%)", border: "1px solid rgba(139,92,246,0.3)", boxShadow: "0 0 40px rgba(109,40,217,0.22), 0 4px 20px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 px-2 lg:px-3 text-xs lg:text-sm">
                <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline">Beranda</span>
              </Button>
            </Link>
            <div className="min-w-0 leading-none">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-bold text-white text-base lg:text-xl tracking-tight">PDF Kitab → KB Draft</p>
                <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: "rgba(139,92,246,0.25)", border: "1px solid rgba(167,139,250,0.4)", color: "rgba(196,181,253,0.9)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />AI
                </span>
              </div>
              <p className="text-violet-300/70 text-[11px] lg:text-[13px]">Upload kitab PDF, chunk per bab</p>
            </div>
          </div>
          {okResults.length > 0 && (
            <Link to="/review" className="hidden sm:inline-flex">
              <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 lg:h-10 px-3 lg:px-4 text-xs lg:text-sm rounded-full">
                <CheckSquare className="w-3.5 h-3.5" />Review KB ({totalChunks})
              </Button>
            </Link>
          )}
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-24 space-y-3 sm:space-y-4 lg:space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-5 max-w-5xl mx-auto">

            {/* ── Left col: Cara Kerja — desktop only ── */}
            <div className="hidden lg:block lg:w-72 xl:w-80 shrink-0">
              <div className="relative overflow-hidden rounded-2xl" style={{ background: "#0d0720" }}>
                <div className="absolute animate-border-beam-slow pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(109,40,217,0.5) 300deg, rgba(167,139,250,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[15px] p-4 lg:p-5" style={{ background: "#0d0720" }}>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-900/40 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-slate-100 text-sm">Cara kerja</h2>
                      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                        {["Upload PDF", "Ekstrak Teks", "Chunk per N Hal.", "KB Draft", "Review → Supabase"].map((s, i, arr) => (
                          <span key={s} className="flex items-center gap-1.5">
                            <span className="text-slate-500 bg-white/10 border border-white/10 px-2 py-0.5 rounded-full font-medium">{s}</span>
                            {i < arr.length - 1 && <span className="text-slate-500 text-xs">→</span>}
                          </span>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-2 mt-3">
                        <div className="flex items-start gap-2 text-[11px] text-emerald-300 bg-emerald-900/20 border border-emerald-700/30 rounded-lg px-3 py-2">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span><strong>PDF teks digital:</strong> ekstraksi langsung, akurat, cepat. Tanpa biaya AI.</span>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                          <ScanLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span><strong>PDF scan/gambar:</strong> aktifkan AI OCR. Biaya ~$0.0002/halaman — 100 hal ≈ $0.02.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right col (mobile: only col) ── */}
            <div className="flex-1 min-w-0 space-y-3 lg:space-y-4">

              {/* ── Mobile: compact info strip ── */}
              <div className="lg:hidden relative overflow-hidden rounded-xl" style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.18)" }}>
                <div className="h-[2px] bg-gradient-to-r from-violet-600 via-purple-400 to-violet-600" />
                <div className="px-3.5 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-900/50 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {["Upload", "Ekstrak", "Chunk", "KB Draft", "Review"].map((s, i, arr) => (
                        <span key={s} className="flex items-center gap-1.5">
                          <span className="text-[10px] text-violet-300/80 font-semibold">{s}</span>
                          {i < arr.length - 1 && <span className="text-violet-700 text-[10px]">›</span>}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400/80">
                        <CheckCircle2 className="w-3 h-3" />PDF teks — gratis
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-amber-400/80">
                        <ScanLine className="w-3 h-3" />Scan — AI OCR ~$0.0002/hal
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Options + Upload card ── */}
              <div className="relative overflow-hidden rounded-2xl" style={{ background: "#0d0720" }}>
                <div className="absolute animate-border-beam pointer-events-none" style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.6) 300deg, rgba(196,181,253,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[15px]" style={{ background: "#0d0720" }}>
                  <div className="h-[3px] bg-gradient-to-r from-violet-500 via-purple-400 to-violet-500 gradient-flow" />

                  <div className="p-4 sm:p-5 lg:p-6 space-y-4 lg:space-y-5">

                    {/* ── Options ── */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-violet-900/50 flex items-center justify-center shrink-0">
                          <Layers className="w-3 h-3 text-violet-400" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-400/80">Pengaturan</span>
                      </div>

                      {/* Category — full width */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                          Kategori Kitab
                        </label>
                        <div className="relative">
                          <select
                            value={category}
                            onChange={e => setCategory(e.target.value)}
                            className="w-full appearance-none text-sm border border-violet-800/40 rounded-xl px-3.5 pr-9 py-2.5 bg-[#0f0a1e] text-slate-200 outline-none focus:border-violet-500/60 transition-colors cursor-pointer"
                            style={{ colorScheme: "dark" }}
                          >
                            <option value="">— Pilih kategori —</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
                        </div>
                      </div>

                      {/* Chunk + OCR row — 2-col on mobile */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Chunk size */}
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                            <FileText className="w-3 h-3 text-indigo-400" />Hal. per KB Draft
                          </label>
                          <div className="bg-[#0f0a1e] border border-violet-800/40 rounded-xl px-3.5 py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-slate-500">Halaman per artikel</span>
                              <span className="text-sm font-bold text-violet-300 tabular-nums">{chunkSize} hal</span>
                            </div>
                            <input
                              type="range" min={5} max={100} step={5}
                              value={chunkSize}
                              onChange={e => setChunkSize(Number(e.target.value))}
                              className="w-full accent-violet-500 h-1.5"
                            />
                          </div>
                        </div>

                        {/* OCR toggle */}
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-violet-400" />AI OCR (Scan)
                          </label>
                          <button
                            onClick={() => setUseOcr(v => !v)}
                            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                              useOcr
                                ? "bg-violet-600/20 text-violet-200 border-violet-500/60"
                                : "bg-[#0f0a1e] text-slate-500 border-violet-800/40 hover:border-violet-700/60"
                            }`}
                          >
                            <span>{useOcr ? "OCR Aktif" : "OCR Nonaktif"}</span>
                            <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${useOcr ? "bg-violet-500" : "bg-slate-700"}`}>
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${useOcr ? "left-4" : "left-0.5"}`} />
                            </div>
                          </button>
                          {!useOcr && (
                            <p className="text-[10px] text-slate-600 flex items-center gap-1 pl-0.5">
                              <Info className="w-3 h-3 shrink-0" />Gratis — hanya PDF teks digital
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* OCR settings (only when OCR enabled) */}
                    {useOcr && (
                      <div className="bg-violet-900/20 border border-violet-700/30 rounded-xl p-3.5 space-y-3.5">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-violet-400" />
                          <span className="text-sm font-semibold text-violet-200">Pengaturan AI OCR</span>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] font-semibold text-slate-500">Maks. halaman scan di-OCR</label>
                            <span className="text-sm font-bold text-violet-300 tabular-nums">{maxOcrPages} hal</span>
                          </div>
                          <input
                            type="range" min={10} max={500} step={10}
                            value={maxOcrPages}
                            onChange={e => setMaxOcrPages(Number(e.target.value))}
                            className="w-full accent-violet-600 h-1.5"
                          />
                          <p className="text-[10px] text-slate-500">
                            Halaman scan di atas limit ini akan di-skip.
                          </p>
                        </div>
                        <div className="bg-white/5 border border-violet-700/30 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                          <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div className="text-xs text-slate-400 space-y-0.5">
                            <div className="font-semibold text-slate-200">Estimasi biaya per file</div>
                            <div>
                              Maks <strong className="text-violet-300">{maxOcrPages} hal</strong> × $0.0002 ≈{" "}
                              <strong className="text-emerald-400">{formatCost(maxOcrPages)}</strong>
                              {files.length > 1 && (
                                <span className="text-slate-500"> · {files.length} file = maks {estimatedCost}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-2 text-[11px] text-violet-300/80">
                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>Butuh <strong>OPENAI_API_KEY</strong>. Proses OCR 4 halaman per API call.</span>
                        </div>
                      </div>
                    )}

                    <div className="border-t border-violet-900/30" />

                    {/* ── Upload Zone ── */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-violet-900/50 flex items-center justify-center shrink-0">
                          <Upload className="w-3 h-3 text-violet-400" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-400/80">Upload File PDF</span>
                      </div>

                      <div
                        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                        onClick={() => inputRef.current?.click()}
                        className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-200 py-8 sm:py-10 ${
                          dragOver
                            ? "border-violet-400 bg-violet-900/20"
                            : "border-violet-900/50 hover:border-violet-600/60 hover:bg-violet-900/10"
                        }`}
                      >
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragOver ? "bg-violet-900/50" : "bg-white/6"}`}>
                          <Upload className={`w-6 h-6 transition-colors ${dragOver ? "text-violet-400" : "text-slate-500"}`} />
                        </div>
                        <div className="text-center px-4">
                          <p className="font-semibold text-slate-200 text-sm">Drag & drop file PDF di sini</p>
                          <p className="text-xs text-slate-500 mt-1">atau ketuk untuk pilih · bisa multi-file</p>
                        </div>
                        <input ref={inputRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
                      </div>

                      {/* File list */}
                      {files.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{files.length} file dipilih</p>
                          {files.map(f => {
                            const insp = inspectMap[f.name];
                            const inspLoading = inspectLoadingMap[f.name];
                            const inspError = inspectErrorMap[f.name];
                            const inspOpen = inspectOpenMap[f.name];
                            const showAll = showAllPagesMap[f.name];
                            const learn = learnMap[f.name];
                            const learnLoading = learnLoadingMap[f.name];
                            const learnError = learnErrorMap[f.name];
                            const learnOpen = learnOpenMap[f.name];
                            return (
                              <div key={f.name} className="space-y-0">
                                {/* File row */}
                                <div className="flex items-center gap-2 bg-white/4 border border-violet-800/30 rounded-xl px-3 py-2.5">
                                  <FileText className="w-4 h-4 text-red-400 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-slate-200 truncate">{f.name}</p>
                                    <p className="text-[10px] text-slate-500">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                                  </div>
                                  {/* Pelajari PDF (AI) button */}
                                  <button
                                    onClick={() => learn
                                      ? setLearnOpenMap(prev => ({ ...prev, [f.name]: !learnOpen }))
                                      : handleLearn(f)
                                    }
                                    disabled={learnLoading}
                                    title="Pelajari isi PDF dengan AI"
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                                      learn
                                        ? learnOpen
                                          ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/50"
                                          : "bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 hover:border-emerald-500/60"
                                        : "bg-emerald-900/30 text-emerald-400 border border-emerald-700/40 hover:border-emerald-500/60"
                                    }`}
                                  >
                                    {learnLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}
                                    {learnLoading ? "AI..." : learn ? (learnOpen ? "Tutup" : "Lihat Isi") : "Pelajari"}
                                  </button>
                                  {/* Inspect button */}
                                  <button
                                    onClick={() => insp
                                      ? setInspectOpenMap(prev => ({ ...prev, [f.name]: !inspOpen }))
                                      : handleInspect(f)
                                    }
                                    disabled={inspLoading}
                                    title="Lihat struktur halaman PDF"
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all ${
                                      insp
                                        ? inspOpen
                                          ? "bg-violet-600/30 text-violet-300 border border-violet-500/50"
                                          : "bg-violet-900/40 text-violet-400 border border-violet-700/40 hover:border-violet-500/60"
                                        : "bg-indigo-900/40 text-indigo-300 border border-indigo-700/40 hover:border-indigo-400/60"
                                    }`}
                                  >
                                    {inspLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                    {inspLoading ? "..." : insp ? (inspOpen ? "Tutup" : "Detail") : "Pratinjau"}
                                  </button>
                                  <button onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                                    className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-white/8">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Inspect error */}
                                {inspError && (
                                  <div className="mt-1.5 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-xl text-[11px] text-red-400 flex items-center gap-2">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{inspError}
                                  </div>
                                )}

                                {/* Inspect panel */}
                                {insp && inspOpen && (
                                  <div className="mt-1.5 rounded-xl border border-violet-700/40 overflow-hidden" style={{ background: "#0a0618" }}>
                                    <div className="h-[2px] bg-gradient-to-r from-indigo-500 via-violet-400 to-purple-500" />

                                    {/* Metadata */}
                                    <div className="px-4 py-3 space-y-3">
                                      <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-900/50 flex items-center justify-center shrink-0 mt-0.5">
                                          <FileText className="w-4 h-4 text-indigo-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-bold text-slate-100 leading-tight" dir="auto">{insp.title || f.name}</p>
                                          {insp.author && <p className="text-[11px] text-slate-400 mt-0.5">Penulis: {insp.author}</p>}
                                          {insp.subject && <p className="text-[11px] text-slate-500 mt-0.5">Subjek: {insp.subject}</p>}
                                        </div>
                                      </div>

                                      {/* Stats row */}
                                      <div className="grid grid-cols-3 gap-2">
                                        {[
                                          { icon: <Hash className="w-3 h-3" />, label: "Total Hal.", value: insp.total_pages, color: "text-slate-200" },
                                          { icon: <AlignLeft className="w-3 h-3" />, label: "Teks", value: insp.text_pages, color: "text-emerald-400" },
                                          { icon: <Image className="w-3 h-3" />, label: "Scan/Gambar", value: insp.scan_pages, color: insp.scan_pages > 0 ? "text-amber-400" : "text-slate-500" },
                                        ].map(({ icon, label, value, color }) => (
                                          <div key={label} className="bg-white/5 rounded-lg px-2.5 py-2 flex items-center gap-2">
                                            <span className={`${color} shrink-0`}>{icon}</span>
                                            <div>
                                              <p className="text-[9px] text-slate-500 uppercase tracking-wide leading-none">{label}</p>
                                              <p className={`text-sm font-bold leading-tight ${color}`}>{value}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      {/* Chapters / Bab detected */}
                                      {insp.chapters.length > 0 && (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
                                            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-400/80">
                                              Bab / Fasal Terdeteksi ({insp.chapters.length})
                                            </span>
                                          </div>
                                          <div className="max-h-44 overflow-y-auto rounded-lg border border-violet-800/30 divide-y divide-violet-900/30" style={{ background: "#0d0720" }}>
                                            {insp.chapters.map((ch, ci) => (
                                              <div key={ci} className="flex items-center gap-2.5 px-3 py-2 hover:bg-violet-900/20 transition-colors group">
                                                <span className="text-[10px] font-bold text-violet-500 tabular-nums w-8 shrink-0">Hal.{ch.page}</span>
                                                <p className="flex-1 text-[11px] text-slate-300 truncate" dir="auto">{ch.heading}</p>
                                                <button
                                                  onClick={() => { setPageStart(ch.page); setPageEnd(insp.total_pages); }}
                                                  className="shrink-0 text-[9px] text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity bg-violet-900/40 border border-violet-700/40 rounded-md px-2 py-1 hover:bg-violet-700/40"
                                                >
                                                  Mulai dari sini
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {insp.chapters.length === 0 && (
                                        <p className="text-[11px] text-slate-500 italic flex items-center gap-1.5">
                                          <Info className="w-3 h-3 shrink-0" />Tidak ada heading bab/fasal terdeteksi secara otomatis
                                        </p>
                                      )}

                                      {/* Range selector */}
                                      <div className="bg-violet-900/20 border border-violet-700/30 rounded-xl p-3.5 space-y-2.5">
                                        <div className="flex items-center gap-1.5">
                                          <Layers className="w-3.5 h-3.5 text-violet-400" />
                                          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-violet-400/80">Pilih Range Halaman</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 space-y-1">
                                            <label className="text-[10px] text-slate-500">Mulai dari hal.</label>
                                            <input
                                              type="number"
                                              min={1} max={insp.total_pages}
                                              value={pageStart}
                                              onChange={e => setPageStart(Math.max(1, Math.min(insp.total_pages, Number(e.target.value))))}
                                              className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 font-bold tabular-nums text-center outline-none focus:border-violet-500/60"
                                              style={{ colorScheme: "dark" }}
                                            />
                                          </div>
                                          <span className="text-slate-500 text-sm mt-4">—</span>
                                          <div className="flex-1 space-y-1">
                                            <label className="text-[10px] text-slate-500">Sampai hal.</label>
                                            <input
                                              type="number"
                                              min={pageStart} max={insp.total_pages}
                                              value={pageEnd || insp.total_pages}
                                              onChange={e => setPageEnd(Math.max(pageStart, Math.min(insp.total_pages, Number(e.target.value))))}
                                              className="w-full bg-[#0f0a1e] border border-violet-800/50 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 font-bold tabular-nums text-center outline-none focus:border-violet-500/60"
                                              style={{ colorScheme: "dark" }}
                                            />
                                          </div>
                                          <button
                                            onClick={() => { setPageStart(1); setPageEnd(insp.total_pages); }}
                                            className="mt-4 px-2.5 py-1.5 text-[10px] font-semibold text-slate-400 border border-slate-700/50 rounded-lg hover:border-violet-600/50 hover:text-violet-300 transition-colors whitespace-nowrap"
                                          >
                                            Semua
                                          </button>
                                        </div>
                                        <p className="text-[11px] text-violet-300/80">
                                          Akan memproses <strong className="text-violet-200">{Math.max(0, (pageEnd || insp.total_pages) - pageStart + 1)} halaman</strong>
                                          {" "}(hal. {pageStart} – {pageEnd || insp.total_pages})
                                        </p>
                                      </div>

                                      {/* Per-page detail toggle */}
                                      <button
                                        onClick={() => setShowAllPagesMap(prev => ({ ...prev, [f.name]: !showAll }))}
                                        className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] text-slate-500 hover:text-violet-300 transition-colors"
                                      >
                                        {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ListCollapse className="w-3.5 h-3.5" />}
                                        {showAll ? "Sembunyikan daftar halaman" : `Lihat detail per halaman (${insp.total_pages} hal.)`}
                                      </button>

                                      {/* Per-page table */}
                                      {showAll && (
                                        <div className="rounded-lg border border-white/8 overflow-hidden">
                                          <div className="grid grid-cols-[40px_52px_1fr_48px] gap-0 text-[9px] font-black uppercase tracking-wide text-slate-600 bg-white/4 border-b border-white/8 px-2 py-1.5">
                                            <span>Hal.</span><span>Tipe</span><span>Isi / Heading</span><span className="text-right">Kata</span>
                                          </div>
                                          <div className="max-h-64 overflow-y-auto divide-y divide-white/5">
                                            {insp.pages.map(pg => (
                                              <div
                                                key={pg.page}
                                                className={`grid grid-cols-[40px_52px_1fr_48px] gap-0 px-2 py-1.5 text-[10px] items-start cursor-pointer transition-colors ${
                                                  pg.page >= pageStart && pg.page <= (pageEnd || insp.total_pages)
                                                    ? "hover:bg-violet-900/20"
                                                    : "opacity-30 hover:opacity-50"
                                                } ${pg.heading ? "bg-violet-950/30" : ""}`}
                                                onClick={() => setPageStart(pg.page)}
                                                title="Klik untuk set mulai dari halaman ini"
                                              >
                                                <span className="font-bold text-violet-500 tabular-nums">{pg.page}</span>
                                                <span>
                                                  {pg.type === "scan"
                                                    ? <span className="text-amber-500 flex items-center gap-0.5"><ScanLine className="w-2.5 h-2.5" />scan</span>
                                                    : pg.type === "text"
                                                      ? <span className="text-emerald-500">teks</span>
                                                      : <span className="text-slate-500">—</span>
                                                  }
                                                </span>
                                                <span className={`truncate leading-snug ${pg.heading ? "font-semibold text-violet-200" : "text-slate-400"}`} dir="auto">
                                                  {pg.heading ? `📌 ${pg.heading}` : pg.preview}
                                                </span>
                                                <span className="text-right text-slate-600 tabular-nums">{pg.words > 0 ? pg.words : "—"}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Learn error */}
                                {learnError && (
                                  <div className="mt-1.5 px-3 py-2 bg-red-900/20 border border-red-700/30 rounded-xl text-[11px] text-red-400 flex items-center gap-2">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{learnError}
                                  </div>
                                )}

                                {/* Pelajari PDF panel */}
                                {learn && learnOpen && (
                                  <div className="mt-1.5 rounded-xl border border-emerald-700/35 overflow-hidden" style={{ background: "#020f0a" }}>
                                    <div className="h-[2px] bg-gradient-to-r from-emerald-600 via-teal-400 to-cyan-500" />

                                    <div className="px-4 py-3 space-y-4">
                                      {/* Header kitab */}
                                      <div className="flex items-start gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-emerald-900/50 flex items-center justify-center shrink-0 mt-0.5">
                                          <GraduationCap className="w-5 h-5 text-emerald-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-bold text-slate-100 leading-tight" dir="auto">{learn.title}</p>
                                          {learn.author && <p className="text-[11px] text-slate-400 mt-0.5">✍️ {learn.author}</p>}
                                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            {learn.language && (
                                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-900/40 text-teal-300 border border-teal-700/40">
                                                <Globe className="w-2.5 h-2.5" />{learn.language}
                                              </span>
                                            )}
                                            {learn.field && (
                                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                                                <Tag className="w-2.5 h-2.5" />{learn.field}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      {/* Stats halaman */}
                                      <div className="grid grid-cols-3 gap-2">
                                        {[
                                          { label: "Total Hal.", value: learn.total_pages, color: "text-slate-200" },
                                          { label: "Teks", value: learn.text_pages, color: "text-emerald-400" },
                                          { label: "Scan", value: learn.scan_pages, color: learn.scan_pages > 0 ? "text-amber-400" : "text-slate-500" },
                                        ].map(({ label, value, color }) => (
                                          <div key={label} className="bg-white/4 rounded-lg px-2.5 py-2 text-center">
                                            <p className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</p>
                                            <p className={`text-sm font-bold ${color}`}>{value}</p>
                                          </div>
                                        ))}
                                      </div>

                                      {/* Overview AI */}
                                      {learn.overview && (
                                        <div className="bg-emerald-950/40 border border-emerald-800/30 rounded-xl p-3">
                                          <div className="flex items-center gap-1.5 mb-1.5">
                                            <Brain className="w-3.5 h-3.5 text-emerald-400" />
                                            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-400/80">Ringkasan AI</span>
                                          </div>
                                          <p className="text-[12px] text-slate-300 leading-relaxed">{learn.overview}</p>
                                        </div>
                                      )}

                                      {/* Topik utama */}
                                      {learn.topics.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                          {learn.topics.map((t, ti) => (
                                            <span key={ti} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/6 text-slate-300 border border-white/10">
                                              {t}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {/* Daftar bab */}
                                      {learn.chapters.length > 0 && (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center gap-1.5">
                                            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                                            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400/80">
                                              Isi Bab / Fasal ({learn.chapters.length})
                                            </span>
                                          </div>
                                          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                                            {learn.chapters.map((ch, ci) => (
                                              <div key={ci} className="bg-white/4 border border-white/8 rounded-xl px-3 py-2.5 hover:bg-emerald-900/15 hover:border-emerald-800/30 transition-colors">
                                                <div className="flex items-start gap-2">
                                                  <div className="w-5 h-5 rounded-md bg-emerald-900/60 flex items-center justify-center shrink-0 mt-0.5">
                                                    <span className="text-[8px] font-black text-emerald-400">{ch.nomor}</span>
                                                  </div>
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                      <p className="text-[12px] font-semibold text-slate-200 leading-snug" dir="auto">{ch.judul}</p>
                                                      {ch.halaman > 0 && (
                                                        <span className="text-[9px] text-emerald-500/70 font-medium">hal. {ch.halaman}</span>
                                                      )}
                                                    </div>
                                                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{ch.pembahasan}</p>
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {learn.chapters.length === 0 && (
                                        <p className="text-[11px] text-slate-500 italic flex items-center gap-1.5">
                                          <Info className="w-3 h-3 shrink-0" />AI tidak dapat mendeteksi struktur bab pada PDF ini.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Process button */}
                          <button
                            onClick={doUpload}
                            disabled={uploading}
                            className={`relative w-full h-12 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-all duration-200 overflow-hidden
                              ${uploading
                                ? "bg-gradient-to-r from-violet-600 to-purple-600 opacity-80 cursor-not-allowed"
                                : "bg-gradient-to-r from-violet-600 to-purple-500 hover:from-violet-500 hover:to-purple-400 active:scale-95"
                              }`}
                            style={uploading ? {} : { boxShadow: "0 0 10px rgba(139,92,246,0.35), 0 2px 10px rgba(0,0,0,0.5)" }}
                          >
                            {uploading && (
                              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-[shimmer_1.5s_infinite] -skew-x-12" />
                            )}
                            {uploading
                              ? <><Loader2 className="w-4 h-4 animate-spin relative z-10" /><span className="relative z-10">{useOcr ? "Memproses + OCR Arab..." : "Memproses..."}</span></>
                              : <><Upload className="w-4 h-4" /><span>Proses {files.length} PDF{category ? ` — ${category}` : ""}{useOcr ? " + OCR" : ""}
                                  {pageEnd > 0 && ` · hal. ${pageStart}–${pageEnd}`}
                                </span></>}
                          </button>

                          {uploading && useOcr && (
                            <p className="text-[11px] text-violet-400/80 text-center flex items-center justify-center gap-1.5">
                              <Sparkles className="w-3 h-3 animate-pulse" />
                              OCR Arab berjalan · estimasi biaya maks {estimatedCost}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              </div>

              {/* ── Results ── */}
              {results.length > 0 && (
                <div className="bg-[#0d0720] rounded-2xl border border-violet-700/40 overflow-hidden"
                  style={{ boxShadow: "0 0 24px rgba(109,40,217,0.14)" }}>
                  <div className="h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500" />
                  <div className="p-4 lg:p-6 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-emerald-900/50 flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-100">Hasil Pemrosesan</h3>
                      </div>
                      {totalChunks > 0 && (
                        <Link to="/review">
                          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs rounded-xl">
                            <CheckSquare className="w-3.5 h-3.5" />Review {totalChunks} KB
                          </Button>
                        </Link>
                      )}
                    </div>

                    {totalChunks > 0 && (
                      <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3 flex items-center gap-2.5 text-sm text-emerald-300">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>
                          <strong>{totalChunks} KB Draft</strong> berhasil dari {okResults.length} PDF.
                          {totalOcrDone > 0 && (
                            <> · <strong className="text-violet-300">{totalOcrDone} hal</strong> di-OCR · {formatCost(totalOcrDone)}</>
                          )}
                        </span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {results.map((r, i) => (
                        <div key={i} className={`rounded-xl border px-3.5 py-3 ${r.status === "ok" ? "bg-white/4 border-white/10" : "bg-red-900/20 border-red-700/30"}`}>
                          <div className="flex items-center gap-2 mb-2">
                            {r.status === "ok"
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                            <p className="text-xs font-semibold text-slate-200 truncate flex-1">{r.filename}</p>
                          </div>

                          {r.status === "ok" ? (
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                              {[
                                { label: "Total Hal.", value: r.total_pages ?? "—", color: "text-slate-200" },
                                { label: "Teks", value: r.text_pages ?? 0, color: "text-emerald-400" },
                                { label: "Scan", value: r.scan_pages ?? 0, color: (r.scan_pages ?? 0) > 0 ? "text-amber-400" : "text-slate-500" },
                                { label: "OCR", value: (r.ocr_pages_done ?? 0) > 0 ? r.ocr_pages_done : "—", color: (r.ocr_pages_done ?? 0) > 0 ? "text-violet-400" : "text-slate-500" },
                                { label: "KB Draft", value: r.chunks ?? 0, color: "text-indigo-400" },
                              ].map(({ label, value, color }) => (
                                <div key={label} className="bg-white/4 rounded-lg px-2.5 py-2">
                                  <p className="text-[9px] text-slate-500 uppercase tracking-wide leading-none mb-1">{label}</p>
                                  <p className={`text-sm font-bold leading-none ${color}`}>{value}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-red-400 mt-1">{r.error}</p>
                          )}

                          {r.status === "ok" && (r.ocr_pages_done ?? 0) > 0 && (
                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-violet-400/80">
                              <DollarSign className="w-3 h-3 shrink-0" />
                              <span>Biaya OCR: {r.ocr_pages_done} hal ≈ {formatCost(r.ocr_pages_done ?? 0)}</span>
                            </div>
                          )}
                          {r.status === "ok" && (r.scan_pages ?? 0) > 0 && !useOcr && (
                            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/80">
                              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{r.scan_pages} halaman scan tidak diekstrak. Aktifkan AI OCR untuk membaca halaman scan.</span>
                            </div>
                          )}

                          {r.status === "ok" && (r.chunks ?? 0) > 0 && (() => {
                            const rs = rapikanState[r.filename];
                            return (
                              <div className="mt-3 flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => handleRapikanFile(r.filename)}
                                  disabled={rs?.loading || rs?.done}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-50
                                    text-violet-300 bg-violet-900/30 hover:bg-violet-800/40 border border-violet-700/40 disabled:cursor-not-allowed">
                                  {rs?.loading
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : rs?.done
                                      ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                      : <Wand2 className="w-3 h-3" />
                                  }
                                  {rs?.loading ? "Memperbaiki..." : rs?.done ? `Selesai (${rs.updated} chunk)` : "Perbaiki dengan AI"}
                                </button>
                                {rs?.error && (
                                  <span className="text-[10px] text-red-400 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />{rs.error}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            </div>{/* /right col */}
          </div>{/* /flex layout */}
        </div>{/* /scrollable */}

        {/* ─── Bottom Nav ─── */}
        <BottomNav active="pdf" />
      </div>
    </div>
  );
}
