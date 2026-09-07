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
  Check
} from 'lucide-react';
import { api, TemplateFolder, DetectedField } from '../lib/api';

interface BuilderPageProps {
  onSuccess: (envelopeId: string) => void;
  onCancel: () => void;
}

export const BuilderPage: React.FC<BuilderPageProps> = ({ onSuccess, onCancel }) => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [recipients, setRecipients] = useState([
    { id: '1', name: '', email: '', role: 'signer', routing_order: 1 }
  ]);
  const [fields, setFields] = useState<any[]>([]);
  const [selectedFieldType, setSelectedFieldType] = useState<string>('signature');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  
  // Organization & Metadata
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>('');
  const [isPublicShared, setIsPublicShared] = useState(false);
  const [publicSlug, setPublicSlug] = useState('');
  const [reminderDays, setReminderDays] = useState<number>(3);
  const [maxReminders, setMaxReminders] = useState<number>(3);

  // States
  const [detecting, setDetecting] = useState(false);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      setFile(dropped);
      if (!title) {
        const base = dropped.name.replace(/\.[^/.]+$/, "");
        setTitle(base);
        setPublicSlug(base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title) {
        const base = selected.name.replace(/\.[^/.]+$/, "");
        setTitle(base);
        setPublicSlug(base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
      }
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
          recipient_id: recipients[0]?.id || '1',
          label: f.name || f.field_type.toUpperCase(),
          placeholder: '',
          options: f.field_type === 'dropdown' || f.field_type === 'radio' ? ['Option 1', 'Option 2'] : []
        }));
        setFields(prev => [...prev, ...newFields]);
        setDetectionNotice(`Auto-detected ${res.total_detected} field anchor(s) via AcroForm & line heuristics!`);
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
    setRecipients(prev => [
      ...prev,
      { id: String(prev.length + 1), name: '', email: '', role: 'signer', routing_order: prev.length + 1 }
    ]);
  };

  const updateRecipient = (index: number, field: string, value: any) => {
    setRecipients(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeRecipient = (index: number) => {
    if (recipients.length <= 1) return;
    setRecipients(prev => prev.filter((_, i) => i !== index));
  };

  const addFieldToCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;

    const defaultDimensions: Record<string, { w: number; h: number }> = {
      signature: { w: 160, h: 50 },
      initials: { w: 90, h: 45 },
      date: { w: 120, h: 35 },
      text: { w: 140, h: 35 },
      number: { w: 110, h: 35 },
      checkbox: { w: 30, h: 30 },
      radio: { w: 140, h: 40 },
      dropdown: { w: 140, h: 40 },
      file: { w: 140, h: 40 }
    };

    const dims = defaultDimensions[selectedFieldType] || { w: 120, h: 35 };

    const newField = {
      id: String(Date.now()),
      field_type: selectedFieldType,
      page_number: 1,
      x: Math.round(xPct),
      y: Math.round(yPct),
      width: dims.w,
      height: dims.h,
      required: true,
      recipient_id: recipients[0]?.id || '1',
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

  const activeField = fields.find(f => f.id === activeFieldId);

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto">
      
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-white/10">
        <button
          onClick={onCancel}
          className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white btn-primary-glow disabled:opacity-50 transition-all shadow-lg"
          >
            <Send className="w-3.5 h-3.5" />
            {submitting ? 'Dispatching Envelope...' : 'Send Envelope'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {detectionNotice && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{detectionNotice}</span>
        </div>
      )}

      {/* Step 1: Upload Document & Auto-Detection */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            1. Document & Automation
          </h2>

          {file && (
            <button
              onClick={handleAutoDetect}
              disabled={detecting}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/20 transition-all disabled:opacity-50"
            >
              <Sparkles className={`w-3.5 h-3.5 ${detecting ? 'animate-spin' : ''}`} />
              {detecting ? 'Analyzing AcroForms & Lines...' : 'Auto-Detect Form Fields'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Document Title *</label>
            <input
              type="text"
              placeholder="e.g. Master Services Agreement 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              Folder Organization
            </label>
            <select
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="">No Folder (Root Workspace)</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Upload Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`p-8 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all ${
            file 
              ? 'border-indigo-500/50 bg-indigo-500/5' 
              : 'border-white/10 hover:border-white/20 bg-slate-900/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <div className="text-sm font-bold text-white">{file.name}</div>
              <div className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB • Ready for signing</div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-10 h-10 text-slate-500" />
              <div className="text-sm font-semibold text-white">Click or drag PDF document to upload</div>
              <div className="text-xs text-slate-400">Supported: PDF files up to 50MB (AcroForm auto-detection ready)</div>
            </div>
          )}
        </div>

        {/* Public Sharing & Reminder Controls */}
        <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-white/5 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-medium text-slate-300">
                <Share2 className="w-3.5 h-3.5 text-indigo-400" />
                Enable Public Intake Form Link (/d/:slug)
              </label>
              <input
                type="checkbox"
                checked={isPublicShared}
                onChange={(e) => setIsPublicShared(e.target.checked)}
                className="rounded text-indigo-600 bg-slate-900 border-white/20 focus:ring-0"
              />
            </div>
            {isPublicShared && (
              <div>
                <input
                  type="text"
                  placeholder="custom-slug"
                  value={publicSlug}
                  onChange={(e) => setPublicSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-xs text-indigo-300 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">Live URL: /d/{publicSlug || 'slug'}</p>
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-white/5 space-y-2">
            <label className="flex items-center gap-2 font-medium text-slate-300">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Automated Follow-Up Reminders
            </label>
            <div className="flex items-center gap-2 text-slate-400">
              <span>Remind every</span>
              <input
                type="number"
                min="1"
                max="30"
                value={reminderDays}
                onChange={(e) => setReminderDays(Number(e.target.value))}
                className="w-14 px-2 py-1 rounded bg-slate-950 border border-white/10 text-center text-white"
              />
              <span>days (max</span>
              <input
                type="number"
                min="1"
                max="10"
                value={maxReminders}
                onChange={(e) => setMaxReminders(Number(e.target.value))}
                className="w-14 px-2 py-1 rounded bg-slate-950 border border-white/10 text-center text-white"
              />
              <span>times)</span>
            </div>
          </div>
        </div>

      </div>

      {/* Step 2: Recipients Setup */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            2. Recipient Workflow & Routing
          </h2>
          <button
            onClick={addRecipient}
            className="flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
          >
            + Add Another Recipient
          </button>
        </div>

        <div className="space-y-3">
          {recipients.map((r, idx) => (
            <div key={r.id} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 rounded-xl bg-slate-900/60 border border-white/5">
              <div className="sm:col-span-1 text-xs text-slate-500 font-mono text-center">#{idx + 1}</div>
              <div className="sm:col-span-4">
                <input
                  type="text"
                  placeholder="Full Name"
                  value={r.name}
                  onChange={(e) => updateRecipient(idx, 'name', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-xs text-white placeholder-slate-500"
                />
              </div>
              <div className="sm:col-span-4">
                <input
                  type="email"
                  placeholder="Email Address"
                  value={r.email}
                  onChange={(e) => updateRecipient(idx, 'email', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-xs text-white placeholder-slate-500"
                />
              </div>
              <div className="sm:col-span-2">
                <select
                  value={r.role}
                  onChange={(e) => updateRecipient(idx, 'role', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-xs text-white"
                >
                  <option value="signer">Signer</option>
                  <option value="approver">Approver</option>
                  <option value="viewer">Viewer (CC)</option>
                </select>
              </div>
              <div className="sm:col-span-1 text-right">
                <button
                  onClick={() => removeRecipient(idx)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 3: Interactive Visual Field Studio */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            3. Visual Field Palette ({fields.length} Placed)
          </h2>
          <span className="text-[11px] text-slate-400">Click canvas to drop field • Click field to inspect/configure</span>
        </div>

        {/* 10 Field Types Palette */}
        <div className="flex flex-wrap items-center gap-2">
          {fieldTypes.map(ft => {
            const Icon = ft.icon;
            const isSelected = selectedFieldType === ft.type;
            return (
              <button
                key={ft.type}
                onClick={() => setSelectedFieldType(ft.type)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 ring-2 ring-indigo-400'
                    : 'bg-slate-900 text-slate-300 border border-white/5 hover:bg-slate-800'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${ft.color}`} />
                {ft.label}
              </button>
            );
          })}
        </div>

        {/* Interactive PDF Sheet Canvas with Field Inspector Drawer */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div 
            onClick={addFieldToCanvas}
            className="lg:col-span-3 relative min-h-[500px] bg-slate-900/80 rounded-2xl border-2 border-white/10 flex flex-col items-center justify-center p-8 overflow-hidden cursor-crosshair group select-none shadow-inner"
          >
            <div className="absolute inset-0 bg-dot-pattern opacity-40 pointer-events-none" />

            {fields.length === 0 ? (
              <div className="text-center z-10 space-y-2 pointer-events-none">
                <PenTool className="w-12 h-12 text-indigo-400/40 mx-auto" />
                <div className="text-sm font-semibold text-slate-300">Click anywhere on this document sheet to anchor a field</div>
                <div className="text-xs text-slate-500">Currently active tool: <span className="font-bold text-indigo-400 uppercase">{selectedFieldType}</span></div>
              </div>
            ) : null}

            {/* Render Placed Fields */}
            {fields.map((f) => {
              const isActive = f.id === activeFieldId;
              return (
                <div
                  key={f.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveFieldId(f.id);
                  }}
                  style={{ left: `${f.x}%`, top: `${f.y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg shadow-lg text-xs cursor-pointer z-20 transition-transform hover:scale-105 ${
                    isActive 
                      ? 'bg-indigo-600 border-2 border-white text-white font-bold ring-4 ring-indigo-500/30' 
                      : 'bg-indigo-950/90 border border-indigo-400/60 text-indigo-200'
                  }`}
                >
                  <span className="text-[10px] tracking-wider uppercase">{f.label || f.field_type}</span>
                  <button
                    onClick={(e) => removeField(f.id, e)}
                    className="hover:text-rose-400 p-0.5 ml-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Field Properties Inspector */}
          <div className="lg:col-span-1 p-4 rounded-2xl bg-slate-900/90 border border-white/10 space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-1.5 font-bold text-white">
                <Sliders className="w-4 h-4 text-indigo-400" />
                Field Inspector
              </div>
              {activeField && (
                <button 
                  onClick={() => removeField(activeField.id)}
                  className="text-rose-400 hover:text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {activeField ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-slate-400 mb-1">Type</label>
                  <span className="font-bold text-indigo-300 uppercase">{activeField.field_type}</span>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Assigned Signer</label>
                  <select
                    value={activeField.recipient_id}
                    onChange={(e) => updateActiveField('recipient_id', e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white"
                  >
                    {recipients.map((r, i) => (
                      <option key={r.id} value={r.id}>#{i + 1}: {r.name || r.email || `Signer ${i + 1}`}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Label</label>
                  <input
                    type="text"
                    value={activeField.label || ''}
                    onChange={(e) => updateActiveField('label', e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Placeholder</label>
                  <input
                    type="text"
                    value={activeField.placeholder || ''}
                    onChange={(e) => updateActiveField('placeholder', e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white"
                  />
                </div>

                {(activeField.field_type === 'dropdown' || activeField.field_type === 'radio') && (
                  <div>
                    <label className="block text-slate-400 mb-1">Options (comma separated)</label>
                    <input
                      type="text"
                      value={(activeField.options || []).join(', ')}
                      onChange={(e) => updateActiveField('options', e.target.value.split(',').map((s: string) => s.trim()))}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <span className="text-slate-300 font-medium">Required Field</span>
                  <input
                    type="checkbox"
                    checked={activeField.required}
                    onChange={(e) => updateActiveField('required', e.target.checked)}
                    className="rounded text-indigo-600 bg-slate-950 border-white/20"
                  />
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                Click any placed field on the canvas to inspect and customize its rules.
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
