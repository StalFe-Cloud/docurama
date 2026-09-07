import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  UserPlus, 
  Send, 
  Trash2, 
  FileText, 
  PenTool, 
  Calendar, 
  Type, 
  CheckSquare, 
  CheckCircle2, 
  Sparkles, 
  ArrowLeft, 
  ShieldAlert, 
  Hash, 
  CircleDot, 
  ChevronDown, 
  Paperclip, 
  Folder, 
  Tag, 
  Share2, 
  Sliders, 
  X, 
  Clock, 
  Save, 
  Check, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Move, 
  GripVertical, 
  Settings2, 
  Plus, 
  Users, 
  Eye, 
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { api, TemplateFolder, DetectedField, DocumentPreview, DocumentPage } from '../lib/api';

interface BuilderPageProps {
  onSuccess: (envelopeId: string) => void;
  onCancel: () => void;
}

interface RecipientRole {
  id: string;
  name: string;
  email: string;
  role: string;
  routing_order: number;
  color: string;
}

const ROLE_COLORS = [
  { name: 'Indigo', color: '#6366f1', bg: 'bg-indigo-500/15', border: 'border-indigo-500', text: 'text-indigo-400', ring: 'ring-indigo-500' },
  { name: 'Emerald', color: '#10b981', bg: 'bg-emerald-500/15', border: 'border-emerald-500', text: 'text-emerald-400', ring: 'ring-emerald-500' },
  { name: 'Amber', color: '#f59e0b', bg: 'bg-amber-500/15', border: 'border-amber-500', text: 'text-amber-400', ring: 'ring-amber-500' },
  { name: 'Purple', color: '#8b5cf6', bg: 'bg-purple-500/15', border: 'border-purple-500', text: 'text-purple-400', ring: 'ring-purple-500' },
  { name: 'Rose', color: '#f43f5e', bg: 'bg-rose-500/15', border: 'border-rose-500', text: 'text-rose-400', ring: 'ring-rose-500' },
];

export const BuilderPage: React.FC<BuilderPageProps> = ({ onSuccess, onCancel }) => {
  const [file, setFile] = useState<File | null>(null);
  const [docPreview, setDocPreview] = useState<DocumentPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [title, setTitle] = useState('');
  
  // Recipients / Roles
  const [recipients, setRecipients] = useState<RecipientRole[]>([
    { id: '1', name: '', email: '', role: 'Signer 1', routing_order: 1, color: '#6366f1' }
  ]);
  const [activeRecipientId, setActiveRecipientId] = useState<string>('1');

  // Fields
  const [fields, setFields] = useState<any[]>([]);
  const [selectedFieldType, setSelectedFieldType] = useState<string>('signature');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Zoom & Viewport
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [showThumbnails, setShowThumbnails] = useState<boolean>(true);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  // Organization & Automation
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>('');
  const [isPublicShared, setIsPublicShared] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');
  const [reminderDays, setReminderDays] = useState<number>(3);
  const [maxReminders, setMaxReminders] = useState<number>(3);

  // Status & Progress
  const [detecting, setDetecting] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    try {
      const data = await api.listFolders();
      setFolders(data);
    } catch (e) {
      console.error('Could not load folders', e);
    }
  };

  const handleProcessFile = async (uploaded: File) => {
    setFile(uploaded);
    const base = uploaded.name.replace(/\.[^/.]+$/, "");
    if (!title) {
      setTitle(base);
      setPublicSlug(base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }

    try {
      setLoadingPreview(true);
      setError('');
      const preview = await api.uploadDocumentPreview(uploaded);
      setDocPreview(preview);
    } catch (err: any) {
      setError(err.message || 'Failed to render document preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const handleAutoDetect = async () => {
    if (!file) return;
    try {
      setDetecting(true);
      setDetectionNotice(null);
      setError('');
      const res = await api.autoDetectFields(file);
      if (res.total_detected > 0) {
        const newFields = res.fields.map((f: DetectedField, i: number) => ({
          id: `detected_${Date.now()}_${i}`,
          field_type: f.field_type,
          page_number: f.page_number,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: true,
          recipient_id: activeRecipientId,
          label: f.name || f.field_type.toUpperCase(),
          placeholder: '',
          options: f.field_type === 'dropdown' || f.field_type === 'radio' ? ['Option 1', 'Option 2'] : []
        }));
        setFields(prev => [...prev, ...newFields]);
        setDetectionNotice(`Auto-detected ${res.total_detected} field anchor(s) across document pages!`);
      } else {
        setDetectionNotice('No standard form widgets or signature underlines found on this document.');
      }
    } catch (err: any) {
      setError(err.message || 'Auto-detection failed.');
    } finally {
      setDetecting(false);
    }
  };

  const addRecipient = () => {
    const nextIdx = recipients.length;
    const colorObj = ROLE_COLORS[nextIdx % ROLE_COLORS.length];
    const newId = String(Date.now());
    setRecipients(prev => [
      ...prev,
      {
        id: newId,
        name: '',
        email: '',
        role: `Signer ${prev.length + 1}`,
        routing_order: prev.length + 1,
        color: colorObj.color
      }
    ]);
    setActiveRecipientId(newId);
  };

  const updateRecipient = (index: number, field: string, value: any) => {
    setRecipients(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeRecipient = (id: string) => {
    if (recipients.length <= 1) return;
    setRecipients(prev => prev.filter(r => r.id !== id));
    if (activeRecipientId === id) {
      setActiveRecipientId(recipients[0].id);
    }
    // Re-assign orphaned fields
    setFields(prev => prev.map(f => f.recipient_id === id ? { ...f, recipient_id: recipients[0].id } : f));
  };

  const handlePageClick = (pageNumber: number, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    const defaultDimensions: Record<string, { w: number; h: number }> = {
      signature: { w: 22, h: 6 },
      initials: { w: 14, h: 5 },
      date: { w: 18, h: 4.5 },
      text: { w: 24, h: 4.5 },
      number: { w: 16, h: 4.5 },
      checkbox: { w: 4, h: 4 },
      radio: { w: 22, h: 5 },
      dropdown: { w: 22, h: 5 },
      file: { w: 22, h: 5 }
    };

    const dims = defaultDimensions[selectedFieldType] || { w: 18, h: 5 };

    const newField = {
      id: String(Date.now()),
      field_type: selectedFieldType,
      page_number: pageNumber,
      x: Math.max(1, Math.min(95, Math.round(xPct - dims.w / 2))),
      y: Math.max(1, Math.min(95, Math.round(yPct - dims.h / 2))),
      width: dims.w,
      height: dims.h,
      required: true,
      recipient_id: activeRecipientId,
      label: selectedFieldType.toUpperCase(),
      placeholder: selectedFieldType === 'text' ? 'Enter text...' : '',
      options: selectedFieldType === 'dropdown' || selectedFieldType === 'radio' ? ['Option A', 'Option B'] : []
    };

    setFields(prev => [...prev, newField]);
    setActiveFieldId(newField.id);
  };

  const updateActiveField = (key: string, value: any) => {
    if (!activeFieldId) return;
    setFields(prev => prev.map(f => f.id === activeFieldId ? { ...f, [key]: value } : f));
  };

  const removeField = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFields(prev => prev.filter(f => f.id !== id));
    if (activeFieldId === id) setActiveFieldId(null);
  };

  const scrollToPage = (pageNum: number) => {
    setActivePageNumber(pageNum);
    const el = pageRefs.current[pageNum];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!file) {
      setError('Please upload a document to sign.');
      return;
    }
    if (!title.trim()) {
      setError('Please specify a document subject.');
      return;
    }
    const invalidRecipient = recipients.find(r => !r.name.trim() || !r.email.trim());
    if (invalidRecipient) {
      setError('Please fill out name and email for all recipients.');
      return;
    }

    try {
      setSubmitting(true);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      fd.append('recipients_json', JSON.stringify(recipients));
      fd.append('fields_json', JSON.stringify(fields));

      const env = await api.createEnvelope(fd);
      onSuccess(env.id);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch envelope.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldTypes = [
    { type: 'signature', label: 'Signature', icon: PenTool, color: 'text-indigo-400' },
    { type: 'initials', label: 'Initials', icon: Type, color: 'text-sky-400' },
    { type: 'date', label: 'Date', icon: Calendar, color: 'text-cyan-400' },
    { type: 'text', label: 'Text Field', icon: Type, color: 'text-slate-300' },
    { type: 'number', label: 'Number', icon: Hash, color: 'text-emerald-400' },
    { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, color: 'text-amber-400' },
    { type: 'radio', label: 'Radio Group', icon: CircleDot, color: 'text-fuchsia-400' },
    { type: 'dropdown', label: 'Dropdown', icon: ChevronDown, color: 'text-rose-400' },
    { type: 'file', label: 'File Attachment', icon: Paperclip, color: 'text-purple-400' },
  ];

  const activeRecipient = recipients.find(r => r.id === activeRecipientId) || recipients[0];
  const activeField = fields.find(f => f.id === activeFieldId);

  // If no document is uploaded yet: High-Assurance Onboarding State
  if (!file || !docPreview) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-20">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blueprints
          </button>
        </div>

        <div className="text-center space-y-3 py-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-xs font-semibold text-indigo-300">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            Visual Document Studio 2.0
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Create or Sign Document Blueprint
          </h1>
          <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
            Upload any PDF agreement or contract. Docurama will render every page in ultra-crisp resolution, auto-detect form lines, and anchor cryptographically sealed signature blocks.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className="p-16 border-2 border-dashed border-indigo-500/30 hover:border-indigo-500/60 rounded-3xl text-center cursor-pointer transition-all bg-slate-900/60 hover:bg-slate-900/90 shadow-2xl group space-y-4"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 text-indigo-400 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform shadow-lg shadow-indigo-500/20">
            {loadingPreview ? (
              <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-8 h-8" />
            )}
          </div>
          <div>
            <div className="text-base font-bold text-white">
              {loadingPreview ? 'Analyzing & Rendering PDF Pages...' : 'Click or Drag PDF Contract Here'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Supports standard and encrypted PDFs up to 50MB with instant page parsing
            </div>
          </div>
        </div>

        {/* Features preview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-400 pt-4">
          <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 space-y-1">
            <div className="font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              AcroForm Auto-Detect
            </div>
            <p className="text-[11px] text-slate-500">Heuristically scans signature lines, checkboxes, and form widgets on all pages.</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 space-y-1">
            <div className="font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              Multi-Role Routing
            </div>
            <p className="text-[11px] text-slate-500">Sequential or parallel signing workflows with individual color-coded field assignment.</p>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 space-y-1">
            <div className="font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-400" />
              PAdES-LTV Compliance
            </div>
            <p className="text-[11px] text-slate-500">Embedded X.509 cryptographic digital certificates with RFC 3161 timestamps.</p>
          </div>
        </div>
      </div>
    );
  }

  // Active Multi-Page Visual Document Studio
  const zoomScale = zoomLevel / 100;
  const basePageWidth = 720; // standard virtual canvas width in px
  const renderedWidth = Math.round(basePageWidth * zoomScale);

  return (
    <div className="fixed inset-0 top-16 bg-slate-950 text-slate-100 flex flex-col z-30 select-none overflow-hidden">
      
      {/* 1. Top Control Header */}
      <div className="h-14 px-6 border-b border-white/10 bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-4 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title="Return to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent border border-transparent hover:border-white/10 focus:border-indigo-500 rounded-lg px-2 py-1 text-xs font-bold text-white max-w-xs sm:max-w-md truncate focus:outline-none transition-all"
              placeholder="Document Title"
            />
          </div>

          <span className="text-[11px] text-slate-400 hidden md:inline-block bg-slate-800 px-2.5 py-0.5 rounded-full border border-white/5 font-medium">
            {docPreview.page_count} Pages • {fields.length} Fields
          </span>
        </div>

        {/* Center Zoom Tools */}
        <div className="hidden lg:flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setZoomLevel(prev => Math.max(50, prev - 15))}
            className="p-1 rounded text-slate-400 hover:text-white"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-xs w-12 text-center text-slate-300 font-semibold">{zoomLevel}%</span>
          <button
            onClick={() => setZoomLevel(prev => Math.min(175, prev + 15))}
            className="p-1 rounded text-slate-400 hover:text-white"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(100)}
            className="p-1 rounded text-slate-400 hover:text-white text-[10px] font-bold"
            title="Reset Zoom (100%)"
          >
            100%
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleAutoDetect}
            disabled={detecting}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/20 transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${detecting ? 'animate-spin' : ''}`} />
            {detecting ? 'Detecting...' : 'Auto-Detect'}
          </button>

          <button
            onClick={() => setShowSettingsDrawer(true)}
            className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
            title="Automation & Sharing Settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow disabled:opacity-50 shadow-lg shadow-indigo-500/30"
          >
            <Send className="w-3.5 h-3.5" />
            {submitting ? 'Dispatching...' : 'Send Document'}
          </button>
        </div>
      </div>

      {/* 2. Main Studio Body: Sidebar + PDF Canvas + Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left Rail: Thumbnails Drawer & Tool Palette */}
        <div className="w-64 border-r border-white/10 bg-slate-900/90 backdrop-blur-md flex flex-col shrink-0 overflow-y-auto">
          
          {/* Signers / Roles Selector */}
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300">
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px] text-indigo-400">
                <Users className="w-3.5 h-3.5" />
                Signer Roles
              </span>
              <button
                onClick={addRecipient}
                className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>

            <div className="space-y-1.5">
              {recipients.map((r, i) => {
                const isActive = r.id === activeRecipientId;
                return (
                  <div
                    key={r.id}
                    onClick={() => setActiveRecipientId(r.id)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between gap-2 ${
                      isActive 
                        ? 'bg-slate-800 border-indigo-500 ring-1 ring-indigo-500/50' 
                        : 'bg-slate-950/40 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <div className="truncate">
                        <input
                          type="text"
                          value={r.name || r.role}
                          placeholder={`Signer ${i + 1} Name`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRecipient(i, 'name', e.target.value)}
                          className="bg-transparent text-xs font-semibold text-white focus:outline-none truncate w-28"
                        />
                        <input
                          type="email"
                          value={r.email}
                          placeholder="email@domain.com"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                          className="bg-transparent text-[10px] text-slate-400 focus:outline-none truncate block w-28"
                        />
                      </div>
                    </div>

                    {recipients.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecipient(r.id);
                        }}
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 10 Field Tools Palette */}
          <div className="p-4 border-b border-white/10 space-y-2">
            <span className="block uppercase tracking-wider text-[10px] font-bold text-slate-400 mb-2">
              Field Tools (Click to Drop)
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              {fieldTypes.map(ft => {
                const Icon = ft.icon;
                const isSelected = selectedFieldType === ft.type;
                return (
                  <button
                    key={ft.type}
                    onClick={() => setSelectedFieldType(ft.type)}
                    className={`p-2 rounded-xl text-left text-xs font-semibold flex items-center gap-2 transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 ring-2 ring-indigo-400'
                        : 'bg-slate-950/60 text-slate-300 border border-white/5 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${ft.color}`} />
                    <span className="truncate text-[11px]">{ft.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Page Thumbnails Nav */}
          <div className="p-4 flex-1 space-y-2">
            <span className="block uppercase tracking-wider text-[10px] font-bold text-slate-400 mb-2">
              Page Thumbnails ({docPreview.page_count})
            </span>

            <div className="space-y-3">
              {docPreview.pages.map((p) => {
                const isActive = activePageNumber === p.page_number;
                return (
                  <div
                    key={p.page_number}
                    onClick={() => scrollToPage(p.page_number)}
                    className={`cursor-pointer group rounded-xl overflow-hidden border-2 transition-all ${
                      isActive ? 'border-indigo-500 ring-2 ring-indigo-500/40 shadow-lg' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="relative bg-white aspect-[0.77] overflow-hidden">
                      <img
                        src={p.url}
                        alt={`Page ${p.page_number}`}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-white font-mono">
                        #{p.page_number}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Central Scrollable Multi-Page Document Canvas */}
        <div className="flex-1 overflow-y-auto p-8 bg-slate-950 flex flex-col items-center bg-dot-pattern">
          
          {detectionNotice && (
            <div className="mb-6 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 max-w-lg w-full">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{detectionNotice}</span>
            </div>
          )}

          {docPreview.pages.map((page: DocumentPage) => {
            const pageFields = fields.filter(f => f.page_number === page.page_number);

            return (
              <div
                key={page.page_number}
                ref={(el) => (pageRefs.current[page.page_number] = el)}
                style={{ width: `${renderedWidth}px` }}
                className="relative shadow-2xl rounded-sm bg-white mb-10 border border-slate-700/60 select-none group transition-all"
              >
                {/* Page Number Badge */}
                <div className="absolute -top-6 left-0 text-[10px] font-mono text-slate-400 font-bold">
                  Page {page.page_number} of {docPreview.page_count}
                </div>

                {/* Real High-Res Rendered Page Image from PyMuPDF */}
                <img
                  src={page.url}
                  alt={`Page ${page.page_number}`}
                  className="w-full h-auto block select-none pointer-events-none"
                />

                {/* Interactive Placement Overlay Layer */}
                <div
                  onClick={(e) => handlePageClick(page.page_number, e)}
                  className="absolute inset-0 cursor-crosshair z-10"
                >
                  {pageFields.map((f) => {
                    const isSelected = f.id === activeFieldId;
                    const recipient = recipients.find(r => r.id === f.recipient_id) || recipients[0];
                    const recColor = recipient?.color || '#6366f1';

                    return (
                      <div
                        key={f.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFieldId(f.id);
                        }}
                        style={{
                          left: `${f.x}%`,
                          top: `${f.y}%`,
                          width: `${f.width}%`,
                          minHeight: '34px',
                          borderColor: recColor,
                          backgroundColor: `${recColor}25`
                        }}
                        className={`absolute rounded-md p-1.5 flex items-center justify-between text-xs cursor-pointer shadow-md transition-all z-20 ${
                          isSelected
                            ? 'ring-2 ring-white border-2'
                            : 'border border-dashed'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: recColor }} />
                          <span className="font-bold text-[10px] uppercase truncate" style={{ color: recColor }}>
                            {f.label || f.field_type}
                          </span>
                        </div>

                        <button
                          onClick={(e) => removeField(f.id, e)}
                          className="hover:text-rose-500 p-0.5 text-slate-600 ml-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })}

        </div>

        {/* Right Rail: Field Properties Inspector */}
        {activeField && (
          <div className="w-72 border-l border-white/10 bg-slate-900/95 backdrop-blur-md p-5 flex flex-col space-y-4 shrink-0 overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                Field Inspector
              </h3>
              <button onClick={() => setActiveFieldId(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Assigned Signer</label>
                <select
                  value={activeField.recipient_id}
                  onChange={(e) => updateActiveField('recipient_id', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white font-semibold"
                >
                  {recipients.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      #{i + 1}: {r.name || r.role} ({r.email || 'No email'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Field Label</label>
                <input
                  type="text"
                  value={activeField.label || ''}
                  onChange={(e) => updateActiveField('label', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Placeholder Text</label>
                <input
                  type="text"
                  value={activeField.placeholder || ''}
                  onChange={(e) => updateActiveField('placeholder', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                />
              </div>

              {(activeField.field_type === 'dropdown' || activeField.field_type === 'radio') && (
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Options (comma separated)</label>
                  <textarea
                    rows={2}
                    value={(activeField.options || []).join(', ')}
                    onChange={(e) => updateActiveField('options', e.target.value.split(',').map((s: string) => s.trim()))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <span className="text-slate-300 font-semibold">Mandatory / Required</span>
                <input
                  type="checkbox"
                  checked={activeField.required}
                  onChange={(e) => updateActiveField('required', e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-white/20 focus:ring-0"
                />
              </div>

              <div className="pt-4 border-t border-white/5">
                <button
                  onClick={() => removeField(activeField.id)}
                  className="w-full py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Field
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* 3. Settings & Reminders Drawer */}
      {showSettingsDrawer && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-slate-900 border-l border-white/10 h-full p-6 space-y-6 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200 text-xs">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-400" />
                Blueprint Settings & Organization
              </h3>
              <button onClick={() => setShowSettingsDrawer(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Folder Destination</label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                >
                  <option value="">No Folder (Root Ledger)</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Tags (comma separated)</label>
                <input
                  type="text"
                  placeholder="e.g. Legal, Executive, Staging"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-white"
                />
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-white flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-indigo-400" />
                    Public Form Sharing (/d/:slug)
                  </label>
                  <input
                    type="checkbox"
                    checked={isPublicShared}
                    onChange={(e) => setIsPublicShared(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-white/20"
                  />
                </div>
                {isPublicShared && (
                  <div>
                    <input
                      type="text"
                      placeholder="custom-slug"
                      value={publicSlug}
                      onChange={(e) => setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-xs text-indigo-300 font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Live link: /d/{publicSlug || 'slug'}</p>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-white/5 space-y-3">
                <label className="font-semibold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Automated Follow-Up Reminders
                </label>
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Every</span>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={reminderDays}
                    onChange={(e) => setReminderDays(Number(e.target.value))}
                    className="w-14 px-2 py-1 rounded bg-slate-900 border border-white/10 text-center text-white"
                  />
                  <span>days, up to</span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxReminders}
                    onChange={(e) => setMaxReminders(Number(e.target.value))}
                    className="w-14 px-2 py-1 rounded bg-slate-900 border border-white/10 text-center text-white"
                  />
                  <span>times</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setShowSettingsDrawer(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white btn-primary-glow"
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
