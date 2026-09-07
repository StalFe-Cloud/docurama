import React, { useState, useRef } from 'react';
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
  ShieldAlert
} from 'lucide-react';
import { api } from '../lib/api';

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      setFile(dropped);
      if (!title) setTitle(dropped.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.[^/.]+$/, ""));
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

    const newField = {
      id: String(Date.now()),
      field_type: selectedFieldType,
      page_number: 1,
      x: Math.round(xPct),
      y: Math.round(yPct),
      width: selectedFieldType === 'signature' ? 160 : 120,
      height: selectedFieldType === 'signature' ? 50 : 35,
      required: true,
      recipient_id: recipients[0]?.id || '1',
      label: selectedFieldType.toUpperCase()
    };

    setFields(prev => [...prev, newField]);
  };

  const removeField = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFields(prev => prev.filter(f => f.id !== id));
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
    { type: 'date', label: 'Date Signed', icon: Calendar, color: 'text-cyan-400' },
    { type: 'text', label: 'Text Field', icon: Type, color: 'text-slate-300' },
    { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, color: 'text-amber-400' },
  ];

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

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow disabled:opacity-50"
        >
          <Send className="w-3.5 h-3.5" />
          {submitting ? 'Dispatching Envelope...' : 'Send Envelope'}
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Upload Document */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          1. Document Details
        </h2>

        <div>
          <label className="block text-xs text-slate-400 mb-1.5 font-medium">Document Title</label>
          <input
            type="text"
            placeholder="e.g. Master Services Agreement 2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

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
              <div className="text-xs text-slate-400">Supported: PDF files up to 25MB</div>
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Recipients Setup */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            2. Recipient Workflow
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

      {/* Step 3: Interactive Field Studio */}
      <div className="p-6 rounded-2xl glass-card border border-white/10 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          3. Place Form Fields (Click Canvas to Anchor)
        </h2>

        {/* Field Palette */}
        <div className="flex flex-wrap items-center gap-2">
          {fieldTypes.map(ft => {
            const Icon = ft.icon;
            const isSelected = selectedFieldType === ft.type;
            return (
              <button
                key={ft.type}
                onClick={() => setSelectedFieldType(ft.type)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'bg-slate-900 text-slate-300 border border-white/5 hover:bg-slate-800'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${ft.color}`} />
                {ft.label}
              </button>
            );
          })}
        </div>

        {/* Interactive PDF Sheet Canvas */}
        <div 
          onClick={addFieldToCanvas}
          className="relative min-h-[480px] bg-slate-900/80 rounded-2xl border-2 border-white/10 flex flex-col items-center justify-center p-8 overflow-hidden cursor-crosshair group select-none"
        >
          <div className="absolute inset-0 bg-dot-pattern opacity-40 pointer-events-none" />

          {fields.length === 0 ? (
            <div className="text-center z-10 space-y-2 pointer-events-none">
              <PenTool className="w-12 h-12 text-indigo-400/40 mx-auto" />
              <div className="text-sm font-semibold text-slate-300">Click anywhere on this sheet to position a field</div>
              <div className="text-xs text-slate-500">Currently selected: <span className="font-bold text-indigo-400 capitalize">{selectedFieldType}</span></div>
            </div>
          ) : null}

          {/* Render Placed Fields */}
          {fields.map((f) => (
            <div
              key={f.id}
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/90 border border-indigo-400/60 shadow-lg text-xs text-indigo-200 z-20"
            >
              <span className="font-bold uppercase text-[10px] tracking-wider">{f.field_type}</span>
              <button
                onClick={(e) => removeField(f.id, e)}
                className="hover:text-rose-400 p-0.5"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
