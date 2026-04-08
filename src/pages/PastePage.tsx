import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Copy, Check, Loader2, AlertCircle, Trash2, ClipboardPaste, Send, CheckCircle2, ScanText, ImagePlus, X, Newspaper, BookOpen, FileText, List, Zap, Radio, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { apiUrl } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { BottomNav } from "@/components/BottomNav";

type InputMode = "paste" | "ocr";
type RapikanFormat = "berita" | "kitab" | "laporan" | "ringkasan" | "poin" | "briefing";
type OcrType = "auto" | "poster" | "dokumen" | "kitab" | "screenshot";

const FORMAT_OPTIONS: { value: RapikanFormat; label: string; desc: string; icon: React.ReactNode; color: string; activeColor: string; activeBg: string; activeBorder: string }[] = [
  { value: "berita",    label: "Berita",    desc: "Artikel berita / portal", icon: <Newspaper className="w-3 h-3" />,  color: "#6b7280", activeColor: "#a78bfa", activeBg: "rgba(139,92,246,0.15)",  activeBorder: "rgba(139,92,246,0.5)" },
  { value: "kitab",     label: "Kitab",     desc: "Teks Arab / kitab agama", icon: <BookOpen className="w-3 h-3" />,   color: "#6b7280", activeColor: "#fb923c", activeBg: "rgba(251,146,60,0.12)",  activeBorder: "rgba(251,146,60,0.5)" },
  { value: "laporan",   label: "Laporan",   desc: "Laporan resmi / formal",  icon: <FileText className="w-3 h-3" />,   color: "#6b7280", activeColor: "#60a5fa", activeBg: "rgba(96,165,250,0.12)",  activeBorder: "rgba(96,165,250,0.5)" },
  { value: "ringkasan", label: "Ringkasan", desc: "3-5 poin inti saja",      icon: <Zap className="w-3 h-3" />,        color: "#6b7280", activeColor: "#fbbf24", activeBg: "rgba(251,191,36,0.12)",  activeBorder: "rgba(251,191,36,0.5)" },
  { value: "poin",      label: "Poin",      desc: "Pure bullet list",        icon: <List className="w-3 h-3" />,       color: "#6b7280", activeColor: "#34d399", activeBg: "rgba(52,211,153,0.12)",  activeBorder: "rgba(52,211,153,0.5)" },
  { value: "briefing",  label: "Briefing",  desc: "Intelijen / diplomatik",  icon: <Radio className="w-3 h-3" />,      color: "#6b7280", activeColor: "#e879f9", activeBg: "rgba(232,121,249,0.12)", activeBorder: "rgba(232,121,249,0.5)" },
];

const OCR_TYPE_OPTIONS: { value: OcrType; label: string; icon: React.ReactNode }[] = [
  { value: "auto",       label: "Auto-Detect",  icon: <Sparkles className="w-3 h-3" /> },
  { value: "poster",     label: "Poster/Flyer", icon: <ImagePlus className="w-3 h-3" /> },
  { value: "dokumen",    label: "Dokumen",       icon: <FileText className="w-3 h-3" /> },
  { value: "kitab",      label: "Kitab Arab",    icon: <BookOpen className="w-3 h-3" /> },
  { value: "screenshot", label: "Screenshot",    icon: <ScanText className="w-3 h-3" /> },
];

export default function PastePage() {
  const navigate = useNavigate();
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ocrImage, setOcrImage] = useState<File | null>(null);
  const [ocrPreview, setOcrPreview] = useState<string>("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [rapikanFormat, setRapikanFormat] = useState<RapikanFormat>("berita");
  const [ocrType, setOcrType] = useState<OcrType>("auto");
  const [activeFormatLabel, setActiveFormatLabel] = useState<string>("");
  const [arabicMode, setArabicMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = !!(title || content || result || ocrImage);

  const handleReset = () => {
    setTitle("");
    setContent("");
    setResult("");
    setError("");
    setOcrImage(null);
    setOcrPreview("");
    setOcrError("");
    setPushStatus(null);
    setActiveFormatLabel("");
    setArabicMode(false);
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRapikan = async () => {
    if (!content.trim()) return;
    setLoading(true);
    setError("");
    setResult("");
    setArabicMode(false);
    const fmtLabel = FORMAT_OPTIONS.find(f => f.value === rapikanFormat)?.label ?? rapikanFormat;
    setActiveFormatLabel(fmtLabel);
    try {
      const res = await fetch(apiUrl("/api/format-text"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), format: rapikanFormat }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal memproses konten.");
      setResult(data.formatted_content);
      setArabicMode(!!data.arabic_mode);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handlePush = async () => {
    if (!result.trim()) return;
    setPushLoading(true);
    setPushStatus(null);
    try {
      const res = await fetch(apiUrl("/api/push-paste"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ title: title.trim() || "Artikel dari Paste", content: result.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal push ke Supabase.");
      if (data.inserted > 0) {
        setPushStatus({ ok: true, msg: `Berhasil masuk ke Supabase (${data.inserted} artikel)` });
      } else if (data.errors?.length) {
        setPushStatus({ ok: false, msg: data.errors[0] });
      } else {
        setPushStatus({ ok: false, msg: "Tidak ada artikel yang berhasil di-push." });
      }
    } catch (e: unknown) {
      setPushStatus({ ok: false, msg: e instanceof Error ? e.message : "Terjadi kesalahan." });
    } finally {
      setPushLoading(false);
    }
  };

  const handleClear = () => {
    setTitle("");
    setContent("");
    setResult("");
    setError("");
    setPushStatus(null);
    setOcrImage(null);
    setOcrPreview("");
    setOcrError("");
    setActiveFormatLabel("");
    textareaRef.current?.focus();
  };

  const setOcrFile = useCallback((file: File) => {
    setOcrImage(file);
    setOcrError("");
    const url = URL.createObjectURL(file);
    setOcrPreview(url);
  }, []);

  const handleOcrImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setOcrFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) setOcrFile(file);
  };

  const handleOcr = async () => {
    if (!ocrImage) return;
    setOcrLoading(true);
    setOcrError("");
    try {
      const form = new FormData();
      form.append("image", ocrImage);
      form.append("ocr_type", ocrType);
      const res = await fetch(apiUrl("/api/ocr-poster"), {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal ekstrak teks.");
      setContent(prev => prev ? prev + "\n\n" + data.text : data.text);
      setInputMode("paste");
    } catch (e: unknown) {
      setOcrError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    } finally {
      setOcrLoading(false);
    }
  };

  const charCount = content.length;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="bg-black relative overflow-hidden flex flex-col" style={{ minHeight: '100dvh' }}>

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none select-none">
        <img src="/bg-home.jpg" alt="" className="absolute inset-0 w-full h-full object-cover sm:hidden"
          style={{ opacity: 0.18, objectPosition: "center 82%", transform: "scale(1.38)", transformOrigin: "center bottom" }} />
        <img src="/bg-desktop.jpg" alt="" className="absolute inset-0 w-full h-full object-cover hidden sm:block"
          style={{ opacity: 0.18 }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(109,40,217,0.22) 0%, transparent 70%)" }} />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 sm:px-8 pt-4 pb-3 shrink-0 border-b border-violet-900/30">
        <button
          onClick={() => navigate("/")}
          className="flex items-center justify-center w-8 h-8 rounded-xl text-violet-400 hover:text-violet-200 hover:bg-violet-900/30 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="font-bold text-white text-sm sm:text-base leading-tight">Paste & Rapikan</h1>
          <p className="text-violet-400/60 text-[10px] sm:text-xs">Tempel artikel, rapikan otomatis dengan AI</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasContent && !loading && !ocrLoading && (
            <button
              onClick={handleReset}
              title="Mulai dari awal"
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 bg-violet-900/30 border border-violet-700/40 rounded-full px-2.5 py-1">
            <Sparkles className="w-3 h-3 text-violet-400" />
            <span className="text-[10px] font-semibold text-violet-300">Rapikan AI</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col sm:flex-row gap-3 sm:gap-4 p-4 sm:p-6 pb-24 sm:pb-6 overflow-y-auto">

        {/* ── Input panel ── */}
        <div className="flex flex-col gap-3 sm:flex-1 sm:min-w-0">

          {/* Title input */}
          <div className="relative overflow-hidden rounded-xl" style={{ background: "#0d0720" }}>
            <div className="absolute animate-border-beam pointer-events-none"
              style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.4) 300deg, rgba(196,181,253,0.8) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[11px] p-3 sm:p-4" style={{ background: "#0d0720" }}>
              <label className="block text-[10px] font-bold text-violet-500 uppercase tracking-widest mb-1.5">
                Judul <span className="text-violet-700 normal-case font-normal tracking-normal">(opsional)</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Judul artikel..."
                className="w-full bg-transparent text-white text-sm placeholder:text-slate-600 outline-none"
              />
            </div>
          </div>

          {/* Input mode switcher + content area */}
          <div className="relative overflow-hidden rounded-xl flex-1" style={{ background: "#0d0720", minHeight: '200px' }}>
            <div className="absolute animate-border-beam-delay pointer-events-none"
              style={{ inset: "-50%", width: "200%", height: "200%", background: "conic-gradient(transparent 260deg, rgba(139,92,246,0.4) 300deg, rgba(196,181,253,0.8) 345deg, transparent 360deg)" }} />
            <div className="relative m-px rounded-[11px] flex flex-col h-full" style={{ background: "#0d0720" }}>

              {/* Tab bar */}
              <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-violet-900/40">
                <button
                  onClick={() => setInputMode("paste")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                  style={{
                    background: inputMode === "paste" ? "rgba(139,92,246,0.2)" : "transparent",
                    color: inputMode === "paste" ? "#a78bfa" : "#4b5563",
                    borderBottom: inputMode === "paste" ? "2px solid #7c3aed" : "2px solid transparent",
                  }}
                >
                  <ClipboardPaste className="w-3 h-3" />Paste Teks
                </button>
                <button
                  onClick={() => setInputMode("ocr")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                  style={{
                    background: inputMode === "ocr" ? "rgba(99,102,241,0.2)" : "transparent",
                    color: inputMode === "ocr" ? "#818cf8" : "#4b5563",
                    borderBottom: inputMode === "ocr" ? "2px solid #6366f1" : "2px solid transparent",
                  }}
                >
                  <ScanText className="w-3 h-3" />OCR Gambar
                </button>
                {inputMode === "paste" && content && (
                  <span className="ml-auto text-[10px] text-slate-600 pr-2">{wordCount} kata · {charCount} karakter</span>
                )}
              </div>

              {/* Paste mode */}
              {inputMode === "paste" && (
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Tempel konten artikel di sini..."
                  className="flex-1 w-full bg-transparent text-slate-300 text-sm leading-relaxed placeholder:text-slate-700 outline-none resize-none px-3 sm:px-4 py-3"
                  style={{ minHeight: '180px' }}
                />
              )}

              {/* OCR mode */}
              {inputMode === "ocr" && (
                <div className="flex flex-col gap-3 p-3 sm:p-4 flex-1">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleOcrImageSelect}
                  />

                  {/* Drop zone / preview */}
                  {!ocrPreview ? (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={handleDrop}
                      className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition-all py-10"
                      style={{
                        borderColor: isDragOver ? "#6366f1" : "rgba(99,102,241,0.3)",
                        background: isDragOver ? "rgba(99,102,241,0.08)" : "rgba(99,102,241,0.04)",
                      }}
                    >
                      <div className="w-12 h-12 rounded-2xl bg-indigo-900/50 border border-indigo-700/50 flex items-center justify-center">
                        <ImagePlus className="w-6 h-6 text-indigo-400" strokeWidth={1.5} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-slate-300">Upload atau drop gambar poster</p>
                        <p className="text-xs text-slate-600 mt-0.5">JPG, PNG, WEBP · AI akan ekstrak semua teks</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 flex-1">
                      {/* Image preview */}
                      <div className="relative rounded-xl overflow-hidden border border-indigo-700/40 flex-1" style={{ minHeight: '140px' }}>
                        <img src={ocrPreview} alt="Preview poster" className="w-full h-full object-contain" style={{ maxHeight: '220px' }} />
                        <button
                          onClick={() => { setOcrImage(null); setOcrPreview(""); setOcrError(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-0 inset-x-0 px-3 py-1.5 text-[10px] text-slate-400 truncate"
                          style={{ background: "rgba(0,0,0,0.6)" }}>
                          {ocrImage?.name}
                        </div>
                      </div>
                      {/* Ganti gambar */}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-200 transition-colors text-center"
                      >
                        Ganti gambar
                      </button>
                    </div>
                  )}

                  {/* OCR type selector */}
                  <div className="space-y-1">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 px-0.5">Tipe Konten</p>
                    <div className="flex flex-wrap gap-1.5">
                      {OCR_TYPE_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setOcrType(opt.value)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all"
                          style={{
                            background: ocrType === opt.value ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                            color: ocrType === opt.value ? "#818cf8" : "#4b5563",
                            border: ocrType === opt.value ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.07)",
                          }}>
                          {opt.icon}{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* OCR error */}
                  {ocrError && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-900/20 border border-red-800/30">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-400 leading-relaxed">{ocrError}</p>
                    </div>
                  )}

                  {/* Extract button */}
                  <button
                    onClick={handleOcr}
                    disabled={!ocrImage || ocrLoading}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: !ocrImage || ocrLoading ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg, #4f46e5, #6366f1)",
                      boxShadow: !ocrImage || ocrLoading ? "none" : "0 0 18px rgba(99,102,241,0.4)",
                    }}
                  >
                    {ocrLoading
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Mengekstrak Teks...</>
                      : <><ScanText className="w-4 h-4" />Ekstrak Teks dari Poster</>
                    }
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Format selector ── */}
          {inputMode === "paste" && (
            <div className="relative overflow-hidden rounded-xl px-3 py-2.5" style={{ background: "#0d0720", border: "1px solid rgba(139,92,246,0.18)" }}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Format Output</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {FORMAT_OPTIONS.map(opt => {
                  const isActive = rapikanFormat === opt.value;
                  return (
                    <button key={opt.value} onClick={() => setRapikanFormat(opt.value)}
                      title={opt.desc}
                      className="flex flex-col items-center gap-1 px-1.5 py-2 rounded-xl text-[10px] font-bold transition-all"
                      style={{
                        background: isActive ? opt.activeBg : "rgba(255,255,255,0.03)",
                        color: isActive ? opt.activeColor : "#4b5563",
                        border: isActive ? `1px solid ${opt.activeBorder}` : "1px solid rgba(255,255,255,0.06)",
                      }}>
                      <span style={{ color: isActive ? opt.activeColor : "#374151" }}>{opt.icon}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {/* Active format description */}
              <p className="text-[10px] text-slate-600 mt-2 text-center">
                {FORMAT_OPTIONS.find(f => f.value === rapikanFormat)?.desc}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRapikan}
              disabled={loading || !content.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: loading || !content.trim() ? "rgba(109,40,217,0.3)" : "linear-gradient(135deg, #6d28d9, #7c3aed)",
                boxShadow: loading || !content.trim() ? "none" : "0 0 20px rgba(139,92,246,0.4)",
              }}
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Sedang Merapikan...</>
                : <><Sparkles className="w-4 h-4" />Rapikan AI{content.trim() ? ` · ${FORMAT_OPTIONS.find(f => f.value === rapikanFormat)?.label ?? ""}` : ""}</>
              }
            </button>
            {(content || title || result) && (
              <button
                onClick={handleClear}
                className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl font-semibold text-xs text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />Reset
              </button>
            )}
          </div>

          {/* Paste hint */}
          {inputMode === "paste" && !content && !loading && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-900/20 border border-violet-800/30">
              <ClipboardPaste className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <p className="text-[11px] text-violet-400/70">
                Paste teks dari artikel berita, blog, atau sumber apapun — atau pakai tab <span className="text-indigo-400 font-semibold">OCR Gambar</span> untuk ekstrak teks dari poster, dokumen, kitab Arab, atau screenshot.
              </p>
            </div>
          )}
        </div>

        {/* ── Result panel ── */}
        <div className="sm:flex-1 sm:min-w-0">
          <div className="relative overflow-hidden rounded-xl h-full" style={{ background: "#0d0720", minHeight: result || loading || error ? '300px' : '0' }}>
            {(result || loading || error) && (
              <>
                <div className="absolute animate-border-beam-slow pointer-events-none"
                  style={{ inset: "-50%", width: "200%", height: "200%", background: error ? "conic-gradient(transparent 260deg, rgba(239,68,68,0.4) 300deg, rgba(252,165,165,0.8) 345deg, transparent 360deg)" : "conic-gradient(transparent 260deg, rgba(16,185,129,0.5) 300deg, rgba(110,231,183,1) 345deg, transparent 360deg)" }} />
                <div className="relative m-px rounded-[11px] flex flex-col h-full" style={{ background: "#0d0720" }}>

                  {/* Result header */}
                  <div className="flex items-center justify-between px-3 sm:px-4 pt-3 pb-2 border-b border-violet-900/40 shrink-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {error
                        ? <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        : <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      }
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: error ? '#f87171' : '#34d399' }}>
                        {error ? "Error" : `Hasil Rapikan AI${activeFormatLabel ? ` · ${activeFormatLabel}` : ""}`}
                      </span>
                      {arabicMode && !error && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                          style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
                          ✦ Arab · GPT-4o
                        </span>
                      )}
                    </div>
                    {result && !error && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
                          style={{
                            background: copied ? "rgba(16,185,129,0.2)" : "rgba(139,92,246,0.2)",
                            color: copied ? "#34d399" : "#a78bfa",
                            border: copied ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(139,92,246,0.4)",
                          }}
                        >
                          {copied ? <><Check className="w-3 h-3" />Tersalin!</> : <><Copy className="w-3 h-3" />Salin</>}
                        </button>
                        <button
                          onClick={handlePush}
                          disabled={pushLoading || pushStatus?.ok === true}
                          className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: pushStatus?.ok ? "rgba(16,185,129,0.2)" : "rgba(59,130,246,0.2)",
                            color: pushStatus?.ok ? "#34d399" : "#93c5fd",
                            border: pushStatus?.ok ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(59,130,246,0.4)",
                          }}
                        >
                          {pushLoading
                            ? <><Loader2 className="w-3 h-3 animate-spin" />Pushing...</>
                            : pushStatus?.ok
                              ? <><CheckCircle2 className="w-3 h-3" />Sudah Push</>
                              : <><Send className="w-3 h-3" />Push Supabase</>
                          }
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Push status bar */}
                  {pushStatus && (
                    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b shrink-0"
                      style={{ borderColor: pushStatus.ok ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)", background: pushStatus.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}>
                      {pushStatus.ok
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        : <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      }
                      <span className="text-[11px]" style={{ color: pushStatus.ok ? "#34d399" : "#f87171" }}>{pushStatus.msg}</span>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3">
                    {loading && (
                      <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-violet-900/40 border border-violet-800/60 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-violet-400" />
                          </div>
                          <div className="absolute -inset-1 rounded-full border-2 border-violet-500/30 animate-ping" />
                        </div>
                        <p className="text-sm text-slate-400 font-medium">AI sedang merapikan konten...</p>
                        <p className="text-xs text-slate-600">Biasanya butuh 5–15 detik</p>
                      </div>
                    )}
                    {error && !loading && (
                      <p className="text-sm text-red-400 leading-relaxed">{error}</p>
                    )}
                    {result && !loading && (
                      <div className="prose prose-sm prose-invert max-w-none
                        prose-headings:font-bold prose-headings:text-slate-100 prose-headings:mt-4 prose-headings:mb-2
                        prose-h2:text-sm prose-h3:text-xs
                        prose-p:text-slate-300 prose-p:leading-[1.85] prose-p:my-2
                        prose-li:text-slate-300 prose-li:leading-relaxed
                        prose-ul:my-2 prose-ul:pl-4
                        prose-strong:text-white prose-strong:font-semibold
                        prose-blockquote:border-violet-600 prose-blockquote:text-slate-400 prose-blockquote:italic
                      ">
                        <ReactMarkdown>{result}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Empty state */}
            {!result && !loading && !error && (
              <div className="relative m-px rounded-[11px] flex flex-col items-center justify-center py-12 px-4 text-center" style={{ background: "#0d0720" }}>
                <div className="w-12 h-12 rounded-2xl bg-violet-900/40 border border-violet-800/50 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-violet-600" />
                </div>
                <p className="text-sm text-slate-600 font-medium">Hasil akan muncul di sini</p>
                <p className="text-xs text-slate-700 mt-1">Paste konten dan klik Rapikan AI</p>
              </div>
            )}
          </div>
        </div>

      </main>

      <BottomNav active="home" />
    </div>
  );
}
