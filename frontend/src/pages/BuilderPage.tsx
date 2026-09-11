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
import { api, TemplateFolder, DetectedField, DocumentPreview, DocumentPage, AccountUsage } from '../lib/api';

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
  verification_channel?: string;
  phone?: string;
}

const ROLE_COLORS = [
  { name: 'Royal Blue', color: '#1D72FE', bg: 'bg-blue-50', border: 'border-[#1D72FE]', text: 'text-[#1D72FE]', ring: 'ring-[#1D72FE]' },
  { name: 'Emerald', color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-500' },
  { name: 'Amber', color: '#f59e0b', bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', ring: 'ring-amber-500' },
  { name: 'Purple', color: '#8b5cf6', bg: 'bg-purple-50', border: 'border-purple-500', text: 'text-purple-700', ring: 'ring-purple-500' },
  { name: 'Rose', color: '#f43f5e', bg: 'bg-rose-50', border: 'border-rose-500', text: 'text-rose-700', ring: 'ring-rose-500' },
];

export const BuilderPage: React.FC<BuilderPageProps> = ({ onSuccess, onCancel }) => {
  const [file, setFile] = useState<File | null>(null);
  const [docPreview, setDocPreview] = useState<DocumentPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [title, setTitle] = useState('');
  
  // Recipients / Roles
  const [recipients, setRecipients] = useState<RecipientRole[]>([
    { id: '1', name: '', email: '', role: 'Signer 1', routing_order: 1, color: '#1D72FE', verification_channel: 'none', phone: '' }
  ]);
  const [activeRecipientId, setActiveRecipientId] = useState<string>('1');


  // Fields
  const [fields, setFields] = useState<any[]>([]);
  const [selectedFieldType, setSelectedFieldType] = useState<string>('signature');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);

  // Zoom & Viewport
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  // Organization & Automation
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');

  // Status & Progress
  const [detecting, setDetecting] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<AccountUsage | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    loadFolders();
    api.getAccountUsage().then(setUsage).catch(() => null);
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

  const updateRecipient = (index: number, key: keyof RecipientRole, value: any) => {
    setRecipients(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = { ...updated[index], [key]: value };
      }
      return updated;
    });
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

  const removeRecipient = (id: string) => {
    if (recipients.length <= 1) return;
    setRecipients(prev => prev.filter(r => r.id !== id));
    if (activeRecipientId === id) {
      setActiveRecipientId(recipients[0].id);
    }
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

    if (usage?.is_quota_exceeded) {
      setError(`Your account has reached its monthly envelope limit (${usage.envelopes_used}/${usage.envelopes_limit}). Upgrade your plan to send new documents.`);
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
    { type: 'signature', label: 'Signature', icon: PenTool, color: 'text-[#1D72FE]' },
    { type: 'initials', label: 'Initials', icon: Type, color: 'text-sky-600' },
    { type: 'date', label: 'Date', icon: Calendar, color: 'text-cyan-600' },
    { type: 'text', label: 'Text Field', icon: Type, color: 'text-slate-600' },
    { type: 'number', label: 'Number', icon: Hash, color: 'text-emerald-600' },
    { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, color: 'text-amber-600' },
    { type: 'radio', label: 'Radio Group', icon: CircleDot, color: 'text-purple-600' },
    { type: 'dropdown', label: 'Dropdown', icon: ChevronDown, color: 'text-rose-600' },
    { type: 'file', label: 'File Attachment', icon: Paperclip, color: 'text-indigo-600' },
  ];

  const activeRecipient = recipients.find(r => r.id === activeRecipientId) || recipients[0];
  const activeField = fields.find(f => f.id === activeFieldId);

  // If no document is uploaded yet: Light Executive Upload State
  if (!file || !docPreview) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-20">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <button
            onClick={onCancel}
            className="flex items-center gap-2 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </button>
        </div>

        <div className="text-center space-y-3 py-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs font-semibold text-[#1D72FE]">
            <Sparkles className="w-3.5 h-3.5 text-[#1D72FE]" />
            Visual Document Studio 2.0
          </div>
          <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
            Create Document Envelope
          </h1>
          <p className="text-xs text-[#64748B] max-w-lg mx-auto leading-relaxed">
            Upload any PDF agreement or contract. Docurama will render every page in ultra-crisp resolution, auto-detect form lines, and anchor cryptographically sealed signature blocks.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className="docurama-dropzone p-16 rounded-3xl text-center cursor-pointer transition-all bg-white shadow-sm hover:shadow-md group space-y-4"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-[#1D72FE] flex items-center justify-center mx-auto group-hover:scale-105 transition-transform shadow-sm">
            {loadingPreview ? (
              <div className="w-8 h-8 border-3 border-[#1D72FE] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Upload className="w-8 h-8" />
            )}
          </div>
          <div>
            <div className="text-base font-bold text-[#0F172A]">
              {loadingPreview ? 'Analyzing & Rendering PDF Pages...' : 'Click or Drag PDF Contract Here'}
            </div>
            <div className="text-xs text-[#64748B] mt-1">
              Supports standard and encrypted PDFs up to 50MB with instant page parsing
            </div>
          </div>
        </div>

        {/* Features preview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-500 pt-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-1.5">
            <div className="font-bold text-[#0F172A] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#1D72FE]" />
              AcroForm Auto-Detect
            </div>
            <p className="text-[11px] text-[#64748B]">Heuristically scans signature lines, checkboxes, and form widgets on all pages.</p>
          </div>
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-1.5">
            <div className="font-bold text-[#0F172A] flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600" />
              Multi-Role Routing
            </div>
            <p className="text-[11px] text-[#64748B]">Sequential or parallel signing workflows with individual color-coded field assignment.</p>
          </div>
          <div className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-1.5">
            <div className="font-bold text-[#0F172A] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-600" />
              PAdES-LTV Compliance
            </div>
            <p className="text-[11px] text-[#64748B]">Embedded X.509 cryptographic digital certificates with RFC 3161 timestamps.</p>
          </div>
        </div>
      </div>
    );
  }

  // Active Multi-Page Visual Document Studio
  const zoomScale = zoomLevel / 100;
  const basePageWidth = 720;
  const renderedWidth = Math.round(basePageWidth * zoomScale);

  return (
    <div className="fixed inset-0 top-16 bg-[#F1F5F9] text-[#0F172A] flex flex-col z-30 select-none overflow-hidden font-sans">
      
      {/* 1. Top Control Header (Light Executive Glass) */}
      <div className="h-14 px-6 border-b border-[#E2E8F0] bg-white/95 backdrop-blur-md flex items-center justify-between gap-4 z-40 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-slate-100 transition-colors"
            title="Return to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#1D72FE]" />
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent border border-transparent hover:border-[#CBD5E1] focus:border-[#1D72FE] rounded-lg px-2 py-1 text-xs font-bold text-[#0F172A] max-w-xs sm:max-w-md truncate focus:outline-none transition-all"
              placeholder="Document Title"
            />
          </div>

          <span className="text-[11px] text-[#64748B] hidden md:inline-block bg-[#F1F5F9] px-2.5 py-0.5 rounded-full border border-[#E2E8F0] font-medium">
            {docPreview.page_count} Pages • {fields.length} Fields
          </span>
        </div>

        {/* Center Zoom Tools */}
        <div className="hidden lg:flex items-center gap-1.5 bg-[#F8FAFC] px-2 py-1 rounded-xl border border-[#CBD5E1] text-xs">
          <button
            onClick={() => setZoomLevel(prev => Math.max(50, prev - 15))}
            className="p-1 rounded text-[#64748B] hover:text-[#0F172A]"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-xs w-12 text-center text-[#0F172A] font-semibold">{zoomLevel}%</span>
          <button
            onClick={() => setZoomLevel(prev => Math.min(175, prev + 15))}
            className="p-1 rounded text-[#64748B] hover:text-[#0F172A]"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(100)}
            className="p-1 rounded text-[#64748B] hover:text-[#0F172A] text-[10px] font-bold"
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
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-[#1D72FE] bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${detecting ? 'animate-spin' : ''}`} />
            {detecting ? 'Detecting...' : 'Auto-Detect'}
          </button>

          <button
            onClick={() => setShowSettingsDrawer(true)}
            className="p-2 rounded-xl text-[#64748B] hover:text-[#0F172A] bg-slate-100 hover:bg-slate-200 transition-colors"
            title="Automation & Sharing Settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn btn-primary px-4 py-2 text-xs font-bold shadow-sm flex items-center gap-2"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{submitting ? 'Dispatching...' : 'Send Document'}</span>
          </button>
        </div>
      </div>

      {/* 2. Main Studio Body: Sidebar + PDF Canvas + Inspector */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left Rail: Tool Palette & Roles */}
        <div className="w-64 border-r border-[#E2E8F0] bg-white flex flex-col shrink-0 overflow-y-auto shadow-sm">
          
          {/* Signers / Roles Selector */}
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-[#0F172A]">
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-[10px] text-[#1D72FE]">
                <Users className="w-3.5 h-3.5" />
                Signer Roles
              </span>
              <button
                onClick={addRecipient}
                className="text-[11px] font-semibold text-[#1D72FE] hover:underline flex items-center gap-1"
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
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex flex-col gap-2 ${
                      isActive 
                        ? 'bg-[#EFF6FF] border-[#1D72FE] shadow-sm' 
                        : 'bg-[#F8FAFC] border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 truncate flex-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <div className="truncate flex-1">
                          <input
                            type="text"
                            value={r.name || r.role}
                            placeholder={`Signer ${i + 1} Name`}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateRecipient(i, 'name', e.target.value)}
                            className="bg-transparent border-0 text-xs font-bold text-[#0F172A] w-full truncate p-0 focus:ring-0 focus:outline-none"
                          />
                          <input
                            type="email"
                            value={r.email}
                            placeholder="email@company.com"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateRecipient(i, 'email', e.target.value)}
                            className="bg-transparent border-0 text-[10px] text-slate-500 w-full truncate p-0 block focus:ring-0 focus:outline-none"
                          />
                        </div>
                      </div>
                      {recipients.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeRecipient(r.id); }}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded shrink-0"
                          title="Remove signer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="pt-1.5 border-t border-slate-200/60 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 font-medium">Auth:</span>
                        <select
                          value={r.verification_channel || 'none'}
                          onChange={(e) => updateRecipient(i, 'verification_channel', e.target.value)}
                          className="text-[10px] py-0.5 px-1.5 bg-white border border-slate-200 rounded font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#1D72FE]"
                        >
                          <option value="none">Direct Link</option>
                          <option value="email_otp">Email OTP</option>
                          <option value="sms_otp">SMS OTP</option>
                          <option value="whatsapp_otp">WhatsApp OTP</option>
                          <option value="telegram_otp">Telegram Bot</option>
                        </select>
                      </div>
                      {(r.verification_channel === 'sms_otp' || r.verification_channel === 'whatsapp_otp') && (
                        <input
                          type="tel"
                          value={r.phone || ''}
                          placeholder="Phone e.g. +33612345678"
                          onChange={(e) => updateRecipient(i, 'phone', e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded text-[10px] px-1.5 py-0.5 text-slate-700 placeholder:text-slate-400 focus:ring-1 focus:ring-[#1D72FE] focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Form Field Elements Palette */}
          <div className="p-4 border-b border-slate-100 space-y-2">
            <span className="block uppercase tracking-wider text-[10px] font-bold text-slate-400 mb-2">
              Select Field to Place (Click page)
            </span>

            <div className="grid grid-cols-2 gap-1.5">
              {fieldTypes.map((ft) => {
                const isSelected = selectedFieldType === ft.type;
                const Icon = ft.icon;
                return (
                  <button
                    key={ft.type}
                    onClick={() => setSelectedFieldType(ft.type)}
                    className={`p-2 rounded-xl text-left font-medium transition-all flex items-center gap-2 border ${
                      isSelected 
                        ? 'bg-[#EFF6FF] border-[#1D72FE] text-[#1D72FE] font-bold shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
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
                      isActive ? 'border-[#1D72FE] ring-2 ring-blue-200 shadow-md' : 'border-slate-200 hover:border-slate-300'
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
        <div className="flex-1 overflow-y-auto p-8 bg-[#F1F5F9] flex flex-col items-center">
          
          {detectionNotice && (
            <div className="mb-6 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 max-w-lg w-full shadow-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
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
                className="relative shadow-xl rounded-sm bg-white mb-10 border border-[#CBD5E1] select-none group transition-all"
              >
                {/* Page Number Badge */}
                <div className="absolute -top-6 left-0 text-[10px] font-mono text-slate-500 font-bold">
                  Page {page.page_number} of {docPreview.page_count}
                </div>

                {/* Real High-Res Rendered Page Image from PyMuPDF */}
                <img
                  src={page.url}
                  alt={`Page ${page.page_number}`}
                  className="w-full h-auto block select-none pointer-events-none"
                />

                {/* Clickable Overlay Layer for Anchoring Coordinates */}
                <div
                  onClick={(e) => handlePageClick(page.page_number, e)}
                  className="absolute inset-0 cursor-crosshair z-10"
                >
                  {pageFields.map((field) => {
                    const recipient = recipients.find(r => r.id === field.recipient_id);
                    const isSelected = activeFieldId === field.id;

                    return (
                      <div
                        key={field.id}
                        onClick={(e) => { e.stopPropagation(); setActiveFieldId(field.id); }}
                        style={{
                          left: `${field.x}%`,
                          top: `${field.y}%`,
                          width: `${field.width}%`,
                          height: `${field.height}%`,
                          borderColor: recipient?.color || '#1D72FE',
                          backgroundColor: isSelected ? 'rgba(29, 114, 254, 0.15)' : 'rgba(255, 255, 255, 0.9)'
                        }}
                        className={`absolute border-2 rounded-lg p-1 flex items-center justify-between text-[11px] shadow-sm cursor-move group/field ${
                          isSelected ? 'ring-2 ring-[#1D72FE]/40 z-20' : 'z-10'
                        }`}
                      >
                        <div className="flex items-center gap-1 truncate text-[#0F172A] font-bold">
                          <GripVertical className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{field.label || field.field_type}</span>
                        </div>

                        <button
                          onClick={(e) => removeField(field.id, e)}
                          className="opacity-0 group-hover/field:opacity-100 p-0.5 text-slate-400 hover:text-rose-600 rounded"
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

        {/* Right Inspector Rail (Field Attributes) */}
        {activeField && (
          <div className="w-72 border-l border-[#E2E8F0] bg-white p-5 space-y-4 shrink-0 overflow-y-auto text-xs shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-[#0F172A] flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-[#1D72FE]" />
                Field Inspector
              </h3>
              <button onClick={() => setActiveFieldId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-500 mb-1 font-medium">Assigned Signer</label>
                <select
                  value={activeField.recipient_id}
                  onChange={(e) => updateActiveField('recipient_id', e.target.value)}
                  className="base-input w-full h-9 px-2.5 text-xs"
                >
                  {recipients.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      #{i + 1}: {r.name || r.role} ({r.email || 'No email'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1 font-medium">Field Label</label>
                <input
                  type="text"
                  value={activeField.label || ''}
                  onChange={(e) => updateActiveField('label', e.target.value)}
                  className="base-input w-full h-9 px-2.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1 font-medium">Placeholder Text</label>
                <input
                  type="text"
                  value={activeField.placeholder || ''}
                  onChange={(e) => updateActiveField('placeholder', e.target.value)}
                  className="base-input w-full h-9 px-2.5 text-xs"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <span className="text-slate-700 font-semibold">Mandatory / Required</span>
                <input
                  type="checkbox"
                  checked={activeField.required}
                  onChange={(e) => updateActiveField('required', e.target.checked)}
                  className="w-4 h-4 rounded text-[#1D72FE] accent-[#1D72FE]"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={() => removeField(activeField.id)}
                  className="w-full py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold flex items-center justify-center gap-1.5 transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-white border-l border-slate-200 h-full p-6 space-y-6 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200 text-xs">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-[#1D72FE]" />
                Blueprint Settings &amp; Organization
              </h3>
              <button onClick={() => setShowSettingsDrawer(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Folder Destination</label>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="base-input w-full h-10 px-3 text-xs"
                >
                  <option value="">No Folder (Root Ledger)</option>
                  {folders.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={() => setShowSettingsDrawer(false)}
                  className="btn btn-primary w-full h-10 font-bold"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
