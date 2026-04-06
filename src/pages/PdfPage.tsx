import { useState, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { Link } from "react-router-dom";
import {
  FileText, Upload, Loader2, ChevronLeft, CheckCircle2,
  AlertCircle, BookOpen, Newspaper, CheckSquare, X, FileJson,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface UploadResult {
  filename: string;
  status: "ok" | "error";
  title?: string;
  pages?: number;
  chars?: number;
  error?: string;
  id?: string;
}

export default function PdfPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);
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
    try {
      const res = await fetch(apiUrl("/api/pdf/upload"), { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setResults(data.results || []);
        if (data.processed > 0) setFiles([]);
      } else {
        setResults([{ filename: "—", status: "error", error: data.error || "Upload gagal" }]);
      }
    } catch {
      setResults([{ filename: "—", status: "error", error: "Gagal terhubung ke backend." }]);
    }
    setUploading(false);
  };

  const okResults = results.filter(r => r.status === "ok");
  const errResults = results.filter(r => r.status === "error");

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
            <p className="font-bold text-white text-sm lg:text-xl tracking-tight">PDF → KB Draft</p>
            <p className="hidden sm:block text-purple-300 text-[11px] lg:text-sm mt-0.5 lg:mt-1">Upload kitab/dokumen PDF, ekstrak teks, simpan ke KB AINA</p>
          </div>
        </div>
        {okResults.length > 0 && (
          <Link to="/review">
            <Button size="sm" className="gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white h-8 lg:h-10 px-3 lg:px-4 text-xs lg:text-sm rounded-full">
              <CheckSquare className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Review KB</span>
            </Button>
          </Link>
        )}
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 p-2.5 sm:p-4 lg:p-6 pb-24 space-y-4">

        {/* Explainer */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 text-sm lg:text-base">Cara kerja fitur ini</h2>
              <p className="text-xs lg:text-sm text-slate-500 mt-1 leading-relaxed">
                Upload file PDF (kitab, panduan, dokumen resmi, dll). Sistem akan mengekstrak teks dari setiap halaman,
                lalu otomatis membuat KB Draft di halaman Review. Dari sana kamu bisa approve dan push langsung ke Supabase AINA.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3 text-[11px]">
                {["Upload PDF", "Ekstrak Teks", "KB Draft", "Review & Approve", "Push Supabase"].map((s, i, arr) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full font-medium">{s}</span>
                    {i < arr.length - 1 && <span className="text-slate-300">→</span>}
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3 leading-relaxed">
                <strong>Catatan:</strong> Fitur ini bekerja paling baik untuk PDF teks asli (bukan scan/gambar). Untuk kitab scan, perlu OCR terlebih dahulu.
              </p>
            </div>
          </div>
        </div>

        {/* Drop Zone */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Upload File PDF</h3>

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 lg:p-12 flex flex-col items-center gap-3 cursor-pointer transition-all ${
              dragOver
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
            }`}
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${dragOver ? "bg-indigo-100" : "bg-slate-100"}`}>
              <Upload className={`w-6 h-6 transition-colors ${dragOver ? "text-indigo-600" : "text-slate-400"}`} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-slate-700 text-sm">Drag & drop file PDF di sini</p>
              <p className="text-xs text-slate-400 mt-1">atau klik untuk memilih file · Bisa multi-file</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
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
                    <p className="text-[10px] text-slate-400">{(f.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); removeFile(f.name); }}
                    className="text-slate-300 hover:text-red-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <Button onClick={doUpload} disabled={uploading}
                className="w-full mt-2 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-10">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? "Mengekstrak teks..." : `Proses ${files.length} PDF`}
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100/80 p-4 lg:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Hasil Ekstraksi</h3>
              {okResults.length > 0 && (
                <Link to="/review">
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs rounded-xl">
                    <CheckSquare className="w-3.5 h-3.5" />Buka Review Dashboard
                  </Button>
                </Link>
              )}
            </div>

            {okResults.length > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span><strong>{okResults.length} PDF</strong> berhasil diekstrak dan disimpan sebagai KB Draft.</span>
              </div>
            )}

            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                  r.status === "ok"
                    ? "bg-emerald-50/50 border-emerald-100"
                    : "bg-red-50/50 border-red-100"
                }`}>
                  {r.status === "ok"
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-700 truncate">{r.filename}</p>
                    {r.status === "ok" ? (
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {r.pages} halaman · {(r.chars! / 1000).toFixed(1)}k karakter
                        {r.title && r.title !== r.filename.replace(".pdf", "") && (
                          <span> · Judul: <em>{r.title}</em></span>
                        )}
                      </p>
                    ) : (
                      <p className="text-[11px] text-red-600 mt-0.5">{r.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {errResults.length > 0 && (
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                {errResults.length} file gagal diekstrak. Pastikan file bukan PDF scan/gambar, atau coba PDF lain.
              </p>
            )}
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
