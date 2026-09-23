"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowLeft, Sparkles, Send, Trash2, Calendar, PenLine, Type,
  CheckSquare, FileSignature, Loader2, Bot, Scale, ShieldAlert,
  ChevronRight, ZoomIn, ZoomOut, Check, Info, FileText, Users, Plus, Edit3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiGet } from "@/lib/client";
import { cn } from "@/lib/utils";

export type FieldKind = "signature" | "initials" | "date" | "text" | "checkbox";

export interface BuilderRecipient {
  name: string;
  email: string;
  role?: string;
}

export interface PlacedField {
  id: string;
  type: FieldKind;
  pageNumber: number;
  x: number; // percentage (0 - 100)
  y: number; // percentage (0 - 100)
  width: number; // percentage (0 - 100)
  height: number; // percentage (0 - 100)
  recipientIndex: number;
  recipientEmail: string;
  recipientName: string;
  label?: string;
  required?: boolean;
}

export const SIGNER_COLORS = [
  { id: 0, name: "Signer 1", bg: "bg-blue-600", border: "border-blue-600", text: "text-blue-600", lightBg: "bg-blue-500/15", hex: "#2563eb", pill: "bg-blue-600 text-white" },
  { id: 1, name: "Signer 2", bg: "bg-emerald-600", border: "border-emerald-600", text: "text-emerald-600", lightBg: "bg-emerald-500/15", hex: "#059669", pill: "bg-emerald-600 text-white" },
  { id: 2, name: "Signer 3", bg: "bg-amber-600", border: "border-amber-600", text: "text-amber-600", lightBg: "bg-amber-500/15", hex: "#d97706", pill: "bg-amber-600 text-white" },
  { id: 3, name: "Signer 4", bg: "bg-purple-600", border: "border-purple-600", text: "text-purple-600", lightBg: "bg-purple-500/15", hex: "#7c3aed", pill: "bg-purple-600 text-white" },
  { id: 4, name: "Signer 5", bg: "bg-rose-600", border: "border-rose-600", text: "text-rose-600", lightBg: "bg-rose-500/15", hex: "#e11d48", pill: "bg-rose-600 text-white" },
];

const FIELD_DEFAULTS: Record<FieldKind, { width: number; height: number; icon: React.ElementType; label: string }> = {
  signature: { width: 25, height: 6.5, icon: PenLine, label: "Signature" },
  initials: { width: 14, height: 5.5, icon: FileSignature, label: "Initials" },
  date: { width: 18, height: 4.8, icon: Calendar, label: "Date" },
  text: { width: 22, height: 4.8, icon: Type, label: "Text Field" },
  checkbox: { width: 4.5, height: 3.5, icon: CheckSquare, label: "Checkbox" },
};

interface DocumentAnalysis {
  is_analyzed: boolean;
  locale: "fr" | "en" | "mixed";
  document_type: string;
  page_count: number;
  word_count: number;
  estimated_read_minutes: number;
  overall_risk_assessment: string;
  risk_badge: "amber" | "blue" | "emerald";
  key_commercial_terms: {
    governing_law: string;
    termination_notice: string;
    payment_terms: string;
    dispute_resolution: string;
  };
  risk_flags: {
    category: string;
    severity: "low" | "medium" | "high";
    title: string;
    summary: string;
  }[];
}

interface AnalysisApiResponse {
  documentId: string;
  filename: string;
  analysis: DocumentAnalysis;
  detectedFields: {
    fieldType: FieldKind;
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
    confidence: number;
    source: string;
  }[];
}

export function DocumentBuilder({
  documentId,
  documentFilename,
  pageCount,
  recipients,
  title,
  message,
  onClose,
  onSend,
  isSending = false,
}: {
  documentId: string;
  documentFilename: string;
  pageCount: number;
  recipients: BuilderRecipient[];
  title: string;
  message: string;
  onClose: () => void;
  onSend: (fields: PlacedField[], recipients: BuilderRecipient[], title: string) => void;
  isSending?: boolean;
}) {
  const [builderRecipients, setBuilderRecipients] = useState<BuilderRecipient[]>(
    recipients && recipients.length > 0 ? recipients : [{ name: "Signer 1", email: "" }]
  );
  const [docTitle, setDocTitle] = useState(title || documentFilename.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "));
  const [recipientsModalOpen, setRecipientsModalOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const signers = builderRecipients.filter((r) => r.role !== "CC");
  const [activeSignerIdx, setActiveSignerIdx] = useState(0);
  const [activeTool, setActiveTool] = useState<FieldKind>("signature");
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [intelOpen, setIntelOpen] = useState(false);

  // Active drag state
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const dragStartPos = useRef<{ mouseX: number; mouseY: number; fieldX: number; fieldY: number; containerW: number; containerH: number } | null>(null);

  const activeSigner = signers[activeSignerIdx] || signers[0] || { name: "Signer 1", email: "" };

  // Auto-detect fields via Document Intelligence API
  const handleAutoDetect = async () => {
    setIsDetecting(true);
    try {
      const res = await apiGet<AnalysisApiResponse>(`/api/workspace/documents/${encodeURIComponent(documentId)}/analysis`);
      if (res.analysis) {
        setAnalysis(res.analysis);
      }

      if (res.detectedFields && res.detectedFields.length > 0) {
        const newFields: PlacedField[] = res.detectedFields.map((df, i) => {
          // Distribute across signers if multiple exist
          const sIdx = df.fieldType === "signature" ? (i % signers.length) : activeSignerIdx;
          const assignedSigner = signers[sIdx] || activeSigner;
          const defaults = FIELD_DEFAULTS[df.fieldType] || FIELD_DEFAULTS.signature;

          // Convert point dimensions to approximate percentages
          const wPct = Math.min(40, Math.max(12, Math.round((df.width / 595) * 100 * 10) / 10));
          const hPct = Math.min(12, Math.max(3.5, Math.round((df.height / 842) * 100 * 10) / 10));

          return {
            id: `field_auto_${Date.now()}_${i}`,
            type: df.fieldType,
            pageNumber: df.pageNumber,
            x: Math.max(2, Math.min(95 - wPct, df.x)),
            y: Math.max(2, Math.min(96 - hPct, df.y)),
            width: wPct || defaults.width,
            height: hPct || defaults.height,
            recipientIndex: sIdx,
            recipientEmail: assignedSigner.email,
            recipientName: assignedSigner.name,
            label: defaults.label,
            required: true,
          };
        });

        setFields(newFields);
        toast.success(`AI Auto-Detect placed ${newFields.length} field${newFields.length > 1 ? "s" : ""} on document!`);
      } else {
        toast.info("No interactive fields detected automatically. Click anywhere on the document to place a signature holder.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run AI detection");
    } finally {
      setIsDetecting(false);
    }
  };

  // Add field at specific location on page
  const handlePageClick = (pageNumber: number, e: React.MouseEvent<HTMLDivElement>) => {
    // If clicking on an existing field, don't place another
    if ((e.target as HTMLElement).closest("[data-placed-field]")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const xPct = Math.round((clickX / rect.width) * 100 * 10) / 10;
    const yPct = Math.round((clickY / rect.height) * 100 * 10) / 10;

    const defaults = FIELD_DEFAULTS[activeTool];
    const placedX = Math.max(1, Math.min(100 - defaults.width - 1, xPct));
    const placedY = Math.max(1, Math.min(100 - defaults.height - 1, yPct));

    const newField: PlacedField = {
      id: `field_${Date.now()}`,
      type: activeTool,
      pageNumber,
      x: placedX,
      y: placedY,
      width: defaults.width,
      height: defaults.height,
      recipientIndex: activeSignerIdx,
      recipientEmail: activeSigner.email,
      recipientName: activeSigner.name,
      label: defaults.label,
      required: true,
    };

    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newField.id);
  };

  // Remove field
  const handleDeleteField = (fieldId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  // Dragging support
  const handlePointerDown = (field: PlacedField, e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setSelectedFieldId(field.id);
    setDraggingFieldId(field.id);

    const pageContainer = (e.currentTarget.closest("[data-page-container]") as HTMLElement) || e.currentTarget.parentElement;
    if (!pageContainer) return;
    const rect = pageContainer.getBoundingClientRect();

    dragStartPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      fieldX: field.x,
      fieldY: field.y,
      containerW: rect.width,
      containerH: rect.height,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingFieldId || !dragStartPos.current) return;
    e.stopPropagation();

    const { mouseX, mouseY, fieldX, fieldY, containerW, containerH } = dragStartPos.current;
    const dx = e.clientX - mouseX;
    const dy = e.clientY - mouseY;

    const dxPct = (dx / containerW) * 100;
    const dyPct = (dy / containerH) * 100;

    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== draggingFieldId) return f;
        const newX = Math.max(1, Math.min(100 - f.width - 1, Math.round((fieldX + dxPct) * 10) / 10));
        const newY = Math.max(1, Math.min(100 - f.height - 1, Math.round((fieldY + dyPct) * 10) / 10));
        return { ...f, x: newX, y: newY };
      })
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingFieldId) {
      setDraggingFieldId(null);
      dragStartPos.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture released
      }
    }
  };

  // Validate and submit
  const handleSendClick = () => {
    // 1. Check all signers have valid names & emails
    const invalidSigner = signers.find((s) => !s.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()));
    if (invalidSigner) {
      toast.error(`Please provide a valid email for ${invalidSigner.name || "Signer"}`);
      setRecipientsModalOpen(true);
      return;
    }

    // 2. Check if every signer has at least 1 signature field
    const missingSigners = signers.filter((s, idx) => {
      return !fields.some((f) => f.recipientIndex === idx && f.type === "signature");
    });

    if (missingSigners.length > 0) {
      toast.warning(
        `Notice: ${missingSigners.map((s) => s.name).join(", ")} does not have a Signature holder placed. You can still send, but placing signature holders is recommended.`,
        {
          action: {
            label: "Send Anyway",
            onClick: () => onSend(fields, builderRecipients, docTitle),
          },
        }
      );
      return;
    }

    onSend(fields, builderRecipients, docTitle);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100 select-none">
      {/* Top Header Bar */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-9 gap-1.5 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="h-5 w-px bg-slate-800" />
          <div className="min-w-0">
            {editingTitle ? (
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => { if (e.key === "Enter") setEditingTitle(false); }}
                autoFocus
                className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-sm font-semibold text-white focus:outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <div className="flex items-center gap-1.5 cursor-pointer group" onClick={() => setEditingTitle(true)}>
                <h1 className="truncate text-sm font-semibold text-white">{docTitle}</h1>
                <Edit3 className="h-3 w-3 text-slate-500 group-hover:text-slate-300 transition-colors" />
              </div>
            )}
            <p className="text-xs text-slate-400">
              {pageCount} page{pageCount > 1 ? "s" : ""} · {fields.length} placed field{fields.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Center: Recipient Selector & Field Tools */}
        <div className="hidden lg:flex items-center gap-4">
          {/* Signer Switcher */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950/70 p-1">
            <span className="px-2 text-xs font-medium text-slate-400">Signer:</span>
            {signers.map((s, idx) => {
              const col = SIGNER_COLORS[idx % SIGNER_COLORS.length];
              const isCurrent = activeSignerIdx === idx;
              const signerFieldsCount = fields.filter((f) => f.recipientIndex === idx).length;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveSignerIdx(idx)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                    isCurrent ? `${col.bg} text-white shadow-sm` : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", isCurrent ? "bg-white" : col.bg)} />
                  <span className="max-w-[100px] truncate">{s.name || `Signer ${idx + 1}`}</span>
                  <span className={cn("rounded px-1 text-[10px]", isCurrent ? "bg-black/20 text-white" : "bg-slate-800 text-slate-400")}>
                    {signerFieldsCount}
                  </span>
                </button>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRecipientsModalOpen(true)}
              className="h-7 px-2 text-xs text-slate-300 hover:text-white hover:bg-slate-800 gap-1 ml-1"
              title="Manage and configure signers"
            >
              <Users className="h-3 w-3" />
              <span>Signers</span>
            </Button>
          </div>

          {/* Field Palette Toolbar */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/70 p-1">
            {(["signature", "initials", "date", "text", "checkbox"] as FieldKind[]).map((kind) => {
              const def = FIELD_DEFAULTS[kind];
              const Icon = def.icon;
              const isActive = activeTool === kind;
              return (
                <Button
                  key={kind}
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTool(kind)}
                  className={cn(
                    "h-8 gap-1.5 px-2.5 text-xs font-medium transition-all",
                    isActive
                      ? "bg-slate-800 text-white shadow-sm ring-1 ring-slate-700"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/40"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{def.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Right Actions: AI Auto-Detect, Document Intel, Send */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoDetect}
            disabled={isDetecting}
            className="h-9 gap-1.5 border-purple-500/30 bg-purple-950/30 text-purple-300 hover:bg-purple-900/40 hover:text-white hover:border-purple-500/60"
          >
            {isDetecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            )}
            <span className="hidden sm:inline">AI Auto-Detect</span>
          </Button>

          {analysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIntelOpen(true)}
              className="h-9 gap-1.5 border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Bot className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden sm:inline">AI Insights</span>
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleSendClick}
            disabled={isSending}
            className="h-9 gap-1.5 bg-primary text-primary-foreground font-semibold hover:bg-primary/90"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>Send Envelope</span>
          </Button>
        </div>
      </header>

      {/* Secondary Bar for Mobile/Tablet */}
      <div className="flex lg:hidden items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Signer:</span>
          <select
            value={activeSignerIdx}
            onChange={(e) => setActiveSignerIdx(Number(e.target.value))}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white"
          >
            {signers.map((s, idx) => (
              <option key={idx} value={idx}>
                {s.name || `Signer ${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-400">Tool:</span>
          <select
            value={activeTool}
            onChange={(e) => setActiveTool(e.target.value as FieldKind)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-white"
          >
            {(["signature", "initials", "date", "text", "checkbox"] as FieldKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {FIELD_DEFAULTS[kind].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Canvas Scroll Area */}
      <main className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-8 docurama-scroll">
        <div className="mx-auto max-w-4xl space-y-8">
          {Array.from({ length: pageCount }, (_, idx) => {
            const pageNum = idx + 1;
            const pageFields = fields.filter((f) => f.pageNumber === pageNum);

            return (
              <div key={pageNum} className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span className="font-medium">Page {pageNum} of {pageCount}</span>
                  <span>Click anywhere on page to place {FIELD_DEFAULTS[activeTool].label}</span>
                </div>

                {/* Page Canvas Container */}
                <div
                  data-page-container
                  onClick={(e) => handlePageClick(pageNum, e)}
                  className="group relative mx-auto w-full cursor-crosshair rounded-lg border border-slate-800 bg-white shadow-2xl transition-all"
                  style={{ minHeight: "842px" }}
                >
                  {/* High-res Rendered PDF Page */}
                  <img
                    src={`/api/workspace/documents/${encodeURIComponent(documentId)}/pages/${pageNum}?dpi=150`}
                    alt={`Document page ${pageNum}`}
                    className="block w-full h-auto rounded-lg select-none pointer-events-none"
                    loading={pageNum === 1 ? "eager" : "lazy"}
                  />

                  {/* Field Overlay Layer */}
                  <div className="absolute inset-0 rounded-lg pointer-events-auto">
                    {pageFields.map((f) => {
                      const signer = signers[f.recipientIndex] || { name: f.recipientName || "Signer" };
                      const col = SIGNER_COLORS[f.recipientIndex % SIGNER_COLORS.length];
                      const isSelected = selectedFieldId === f.id;
                      const Icon = FIELD_DEFAULTS[f.type]?.icon || PenLine;

                      return (
                        <div
                          key={f.id}
                          data-placed-field
                          onPointerDown={(e) => handlePointerDown(f, e)}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          style={{
                            left: `${f.x}%`,
                            top: `${f.y}%`,
                            width: `${f.width}%`,
                            height: `${f.height}%`,
                          }}
                          className={cn(
                            "absolute flex flex-col justify-between rounded border-2 p-1 text-xs cursor-move transition-shadow touch-none select-none",
                            col.border,
                            col.lightBg,
                            isSelected
                              ? "ring-2 ring-white shadow-lg z-30"
                              : "shadow-sm hover:shadow-md z-20"
                          )}
                        >
                          {/* Field Header / Badge */}
                          <div className="flex items-center justify-between gap-1 leading-none">
                            <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold", col.pill)}>
                              <Icon className="h-3 w-3" />
                              <span className="truncate max-w-[80px]">{signer.name || `Signer ${f.recipientIndex + 1}`}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteField(f.id, e)}
                              className="rounded p-0.5 text-slate-700 hover:bg-red-500 hover:text-white transition-colors"
                              title="Delete field"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {/* Field Label Body */}
                          <div className="flex items-center justify-center font-medium text-slate-800">
                            <span className="truncate text-[11px] font-semibold tracking-wide uppercase">
                              {f.label || FIELD_DEFAULTS[f.type].label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Document Intelligence Insights Sheet */}
      <Sheet open={intelOpen} onOpenChange={setIntelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-slate-900 border-slate-800 text-slate-100 docurama-scroll overflow-y-auto">
          <SheetHeader className="border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-sky-400" />
              <SheetTitle className="text-white">AI Document Intelligence</SheetTitle>
            </div>
          </SheetHeader>

          {analysis && (
            <div className="space-y-6 pt-4 text-sm">
              {/* Classification Card */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Classification</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize text-xs font-semibold",
                      analysis.risk_badge === "emerald"
                        ? "border-emerald-500/40 text-emerald-400 bg-emerald-950/30"
                        : "border-amber-500/40 text-amber-400 bg-amber-950/30"
                    )}
                  >
                    {analysis.overall_risk_assessment}
                  </Badge>
                </div>
                <p className="text-base font-semibold text-white">{analysis.document_type}</p>
                <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                  <span>{analysis.page_count} pages</span>
                  <span>·</span>
                  <span>{analysis.word_count.toLocaleString()} words</span>
                  <span>·</span>
                  <span>~{analysis.estimated_read_minutes} min read</span>
                </div>
              </div>

              {/* Commercial Terms */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5 text-sky-400" /> Key Legal Terms
                </h4>
                <div className="grid gap-2 text-xs">
                  <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5">
                    <p className="text-slate-400">Governing Law</p>
                    <p className="font-medium text-white">{analysis.key_commercial_terms.governing_law || "Not specified"}</p>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5">
                    <p className="text-slate-400">Termination Notice</p>
                    <p className="font-medium text-white">{analysis.key_commercial_terms.termination_notice || "Not specified"}</p>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-950/40 p-2.5">
                    <p className="text-slate-400">Dispute Resolution</p>
                    <p className="font-medium text-white">{analysis.key_commercial_terms.dispute_resolution || "Competent jurisdiction"}</p>
                  </div>
                </div>
              </div>

              {/* Risk Flags */}
              {analysis.risk_flags && analysis.risk_flags.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-400" /> Risk Flags & Observations
                  </h4>
                  <div className="space-y-2">
                    {analysis.risk_flags.map((flag, idx) => (
                      <div key={idx} className="rounded border border-amber-900/30 bg-amber-950/20 p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-300">{flag.title}</span>
                          <span className="text-[10px] uppercase font-bold text-amber-500">{flag.severity}</span>
                        </div>
                        <p className="text-slate-300 leading-relaxed">{flag.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Manage Signers Modal */}
      <Dialog open={recipientsModalOpen} onOpenChange={setRecipientsModalOpen}>
        <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Manage Signers
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Assign documents to multiple recipients. Each signer will receive their own secure signing link.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {builderRecipients.map((r, idx) => {
              const col = SIGNER_COLORS[idx % SIGNER_COLORS.length];
              return (
                <div key={idx} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", col.bg)}>
                    {idx + 1}
                  </span>
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    <Input
                      value={r.name}
                      placeholder={`Signer ${idx + 1}`}
                      onChange={(e) => {
                        const next = [...builderRecipients];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setBuilderRecipients(next);
                        // Also update placed fields label
                        setFields((prev) =>
                          prev.map((f) => (f.recipientIndex === idx ? { ...f, recipientName: e.target.value } : f))
                        );
                      }}
                      className="h-8 bg-slate-900 border-slate-700 text-xs text-white"
                    />
                    <Input
                      type="email"
                      value={r.email}
                      placeholder="email@example.com"
                      onChange={(e) => {
                        const next = [...builderRecipients];
                        next[idx] = { ...next[idx], email: e.target.value };
                        setBuilderRecipients(next);
                        // Also update placed fields email
                        setFields((prev) =>
                          prev.map((f) => (f.recipientIndex === idx ? { ...f, recipientEmail: e.target.value } : f))
                        );
                      }}
                      className="h-8 bg-slate-900 border-slate-700 text-xs text-white"
                    />
                  </div>
                  {builderRecipients.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => {
                        const next = builderRecipients.filter((_, i) => i !== idx);
                        setBuilderRecipients(next);
                        if (activeSignerIdx >= next.length) setActiveSignerIdx(0);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}

            {builderRecipients.length < 5 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newIdx = builderRecipients.length;
                  setBuilderRecipients([...builderRecipients, { name: `Signer ${newIdx + 1}`, email: "" }]);
                }}
                className="w-full h-8 gap-1.5 border-dashed border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" /> Add another signer
              </Button>
            )}
          </div>

          <DialogFooter>
            <Button
              className="h-9 w-full bg-primary text-primary-foreground font-medium text-xs"
              onClick={() => setRecipientsModalOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
