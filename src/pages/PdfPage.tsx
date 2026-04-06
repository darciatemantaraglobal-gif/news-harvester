import { useState, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  FileText, Upload, Loader2, ChevronLeft, CheckCircle2,
  AlertCircle, BookOpen, Newspaper, CheckSquare, X,
  Sparkles, Info, ScanLine, Layers, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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

const CATEGORIES = [
  "Fiqh", "Aqidah", "Akhlak", "Hadits", "Tafsir",
  "Sirah", "Nahwu / Sharaf", "Bahasa Arab", "Umum",
];

// Estimasi biaya per halaman scan dengan gpt-4o-mini + detail:low
// Image tokens (low): 85 × $0.15/1M = $0.0000128
// Output tokens (~300 per hal): 300 × $0.60/1M = $0.00018
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

  const [category, setCategory] = useState("");
  const [chunkSize, setChunkSize] = useState(20);
  const [useOcr, setUseOcr] = useState(false);
  const [maxOcrPages, setMaxOcrPages] = useState(150);

  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...pdfs.filter(f => !names.has(f.name))];
    });
  };

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name));

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

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
    <div className="flex flex-col min-h-screen bg-[#f0f1f8] text-slate-900">

      {/* ─── Header ─── */}
      <div className="mx-2 sm:mx-4 lg:mx-6 mt-2 sm:mt-4 lg:mt-5 bg-gradient-to-r from-[#1a0533] via-[#2e0d5e] to-[#3d1480] rounded-xl sm:rounded-2xl px-3 sm:px-5 lg:px-8 py-2.5 sm:py-3.5 lg:py-5 flex items-center justify-between shrink-0 shadow-lg shadow-purple-900/20">
        <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-1 lg:gap-2 text-white/70 hover:text-white hover:bg-white/15 -ml-1 h-8 lg:h-10 px-2 lg:px-3 text-xs lg:text-sm">
              <ChevronLeft className="w-3.5 h-3.5 lg:w-4 lg:h-4" /><span className="hidden sm:inline">Scraper</span>
            </Button>
          </Link>
          <div className="w-px h-4 lg:h-6 bg-white/30 shrink-0 hidden sm:block" />
          <div className="min-w-0">
            <p className="font-bold text-white text-sm lg:text-xl tracking-tight">PDF Kitab → KB Draft</p>
            <p className="hidden sm:block text-purple-300 text-[11px] lg:text-sm mt-0.5 lg:mt-1">Upload kitab PDF, ekstrak teks Arab, chunk per bab</p>
          </div>
        </div>
        {okResults.length > 0 && (
          <Link to="/review">
            <Button size="sm" className="gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white h-8 lg:h-10 px-3 lg:px-4 text-xs lg:text-sm rounded-full">
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Review KB ({totalChunks})</span>
            </Button>
          </Link>
        )}
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 p-2.5 sm:p-4 lg:p-6 pb-24 space-y-4">

        {/* Explainer */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <BookOpen className="w-4.5 h-4.5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-slate-800 text-sm">Cara kerja</h2>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                {["Upload PDF", "Ekstrak Teks", "Chunk per N Hal.", "KB Draft", "Review → Supabase"].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full font-medium">{s}</span>
                    {i < arr.length - 1 && <span className="text-slate-300 text-xs">→</span>}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <div className="flex items-start gap-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span><strong>PDF teks digital:</strong> ekstraksi langsung, akurat, cepat. Tanpa biaya AI.</span>
                </div>
                <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <ScanLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span><strong>PDF scan/gambar:</strong> aktifkan AI OCR. Biaya ~$0.0002/halaman — 100 hal ≈ $0.02.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Options + Upload */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-6 space-y-5">

          {/* Options row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Category */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />Kategori Kitab
              </label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">— Pilih kategori —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Chunk size */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-400" />Halaman per KB Draft
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min={5} max={100} step={5}
                  value={chunkSize}
                  onChange={e => setChunkSize(Number(e.target.value))}
                  className="flex-1 accent-indigo-600"
                />
                <span className="text-sm font-bold text-indigo-600 w-10 text-center">{chunkSize}</span>
              </div>
              <p className="text-[10px] text-slate-400">Tiap {chunkSize} halaman = 1 artikel KB</p>
            </div>

            {/* OCR toggle */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />AI OCR untuk Scan
              </label>
              <button
                onClick={() => setUseOcr(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                  useOcr
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-white text-slate-500 border-slate-200 hover:border-violet-300"
                }`}
              >
                <div className={`w-8 h-4 rounded-full transition-colors relative ${useOcr ? "bg-white/30" : "bg-slate-200"}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${useOcr ? "left-4 bg-white" : "left-0.5 bg-white"}`} />
                </div>
                {useOcr ? "OCR Aktif" : "OCR Nonaktif"}
              </button>
              {!useOcr && (
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Info className="w-3 h-3" />Gratis — hanya untuk PDF teks digital.
                </p>
              )}
            </div>
          </div>

          {/* OCR settings (only when OCR enabled) */}
          {useOcr && (
            <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-800">Pengaturan AI OCR</span>
              </div>

              {/* Max OCR pages slider */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">Maks. halaman scan di-OCR per file</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min={10} max={500} step={10}
                    value={maxOcrPages}
                    onChange={e => setMaxOcrPages(Number(e.target.value))}
                    className="flex-1 accent-violet-600"
                  />
                  <span className="text-sm font-bold text-violet-700 w-16 text-right">{maxOcrPages} hal</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Halaman scan melebihi limit ini akan di-skip (tidak di-OCR).
                  Berguna untuk membatasi biaya kitab tebal.
                </p>
              </div>

              {/* Cost estimate */}
              <div className="bg-white border border-violet-200 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-xs text-slate-600 space-y-0.5">
                  <div className="font-semibold text-slate-700">Estimasi biaya OCR (per file)</div>
                  <div>
                    Maks <strong className="text-violet-700">{maxOcrPages} hal</strong> × $0.0002 ≈{" "}
                    <strong className="text-emerald-600">{formatCost(maxOcrPages)}</strong> per file
                    {files.length > 1 && (
                      <span className="text-slate-400"> · {files.length} file = maks {estimatedCost}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Menggunakan gpt-4o-mini + detail rendah (dioptimasi untuk hemat biaya)
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 text-[11px] text-violet-700">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Butuh <strong>OPENAI_API_KEY</strong>. Proses OCR 4 halaman per API call (batch) — lebih cepat dari sebelumnya.</span>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100" />

          {/* Drop Zone */}
          <div>
            <h3 className="text-sm font-bold text-slate-800 mb-3">Upload File PDF</h3>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all ${
                dragOver
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/70"
              }`}
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${dragOver ? "bg-indigo-100" : "bg-slate-100"}`}>
                <Upload className={`w-5 h-5 transition-colors ${dragOver ? "text-indigo-600" : "text-slate-400"}`} />
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-700 text-sm">Drag & drop file PDF di sini</p>
                <p className="text-xs text-slate-400 mt-0.5">atau klik untuk pilih · bisa multi-file sekaligus</p>
              </div>
              <input ref={inputRef} type="file" accept=".pdf" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{files.length} file dipilih</p>
                {files.map(f => (
                  <div key={f.name} className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <FileText className="w-4 h-4 text-red-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{f.name}</p>
                      <p className="text-[10px] text-slate-400">{(f.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); removeFile(f.name); }} className="text-slate-300 hover:text-red-400 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <Button onClick={doUpload} disabled={uploading} className="w-full mt-2 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-10">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading
                    ? `Memproses${useOcr ? " + OCR Arab (batch)..." : "..."}`
                    : `Proses ${files.length} PDF${category ? ` — ${category}` : ""}${useOcr ? ` + OCR` : ""}`}
                </Button>
                {uploading && useOcr && (
                  <p className="text-[11px] text-violet-600 text-center flex items-center justify-center gap-1.5">
                    <Sparkles className="w-3 h-3 animate-pulse" />
                    OCR Arab berjalan · 4 halaman per API call · estimasi biaya maks {estimatedCost}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Hasil Pemrosesan</h3>
              {totalChunks > 0 && (
                <Link to="/review">
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs rounded-xl">
                    <CheckSquare className="w-3.5 h-3.5" />Review {totalChunks} KB Draft
                  </Button>
                </Link>
              )}
            </div>

            {totalChunks > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  <strong>{totalChunks} KB Draft</strong> berhasil dibuat dari {okResults.length} PDF.
                  {totalOcrDone > 0 && (
                    <> · <strong className="text-violet-700">{totalOcrDone} hal</strong> di-OCR
                    · biaya ≈ {formatCost(totalOcrDone)}</>
                  )}
                </span>
              </div>
            )}

            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`rounded-xl border px-4 py-3 ${r.status === "ok" ? "bg-slate-50 border-slate-200" : "bg-red-50/50 border-red-100"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {r.status === "ok"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      : <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
                    <p className="text-xs font-semibold text-slate-700 truncate flex-1">{r.filename}</p>
                  </div>

                  {r.status === "ok" ? (
                    <div className="pl-6 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 mt-1">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Total Hal.</p>
                        <p className="text-sm font-bold text-slate-700">{r.total_pages ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Teks</p>
                        <p className="text-sm font-bold text-emerald-600">{r.text_pages ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Scan</p>
                        <p className={`text-sm font-bold ${(r.scan_pages ?? 0) > 0 ? "text-amber-500" : "text-slate-400"}`}>{r.scan_pages ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">OCR Done</p>
                        <p className={`text-sm font-bold ${(r.ocr_pages_done ?? 0) > 0 ? "text-violet-600" : "text-slate-300"}`}>
                          {(r.ocr_pages_done ?? 0) > 0 ? r.ocr_pages_done : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">KB Draft</p>
                        <p className="text-sm font-bold text-indigo-600">{r.chunks ?? 0}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="pl-6 text-[11px] text-red-600 mt-1">{r.error}</p>
                  )}

                  {r.status === "ok" && (r.ocr_pages_done ?? 0) > 0 && (
                    <div className="pl-6 mt-2 flex items-center gap-1.5 text-[11px] text-violet-600">
                      <DollarSign className="w-3 h-3 shrink-0" />
                      <span>Biaya OCR: {r.ocr_pages_done} hal × $0.0002 ≈ {formatCost(r.ocr_pages_done ?? 0)}</span>
                    </div>
                  )}
                  {r.status === "ok" && (r.scan_pages ?? 0) > 0 && !useOcr && (
                    <div className="pl-6 mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{r.scan_pages} halaman scan tidak diekstrak. Aktifkan AI OCR untuk membaca halaman scan.</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Bottom Nav ─── */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-around h-14 lg:h-16 px-2 lg:px-8 max-w-screen-2xl mx-auto">
          <Link to="/" className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors min-w-[60px] lg:min-w-[100px]">
            <Newspaper style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">Scraper</span>
          </Link>
          <Link to="/review" className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors min-w-[60px] lg:min-w-[100px]">
            <CheckSquare style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">Review</span>
          </Link>
          <div className="flex flex-col items-center gap-0.5 lg:gap-1 px-4 lg:px-8 py-1.5 lg:py-2 rounded-xl lg:rounded-2xl bg-slate-900 text-white min-w-[60px] lg:min-w-[100px]">
            <FileText style={{ width: 18, height: 18 }} className="lg:!w-5 lg:!h-5" />
            <span className="text-[10px] lg:text-xs font-semibold">PDF</span>
          </div>
        </div>
      </nav>
    </div>
  );
}
