import React, { useState, useEffect, useRef } from 'react';
import { 
  PenTool, 
  CheckCircle2, 
  Smartphone, 
  Type, 
  Upload, 
  RotateCcw, 
  ShieldCheck, 
  QrCode, 
  Check, 
  X,
  FileCheck2,
  Lock,
  UserX,
  UserCheck,
  Calendar,
  Hash,
  Paperclip,
  CircleDot,
  AlertCircle
} from 'lucide-react';
import { api } from '../lib/api';

interface SigningStudioPageProps {
  token: string;
  onDone?: () => void;
}

export const SigningStudioPage: React.FC<SigningStudioPageProps> = ({ token, onDone }) => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [activeModalField, setActiveModalField] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'phone'>('draw');
  const [typedName, setTypedName] = useState('');
  const [primarySignature, setPrimarySignature] = useState<string>('');
  const [mobileQr, setMobileQr] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedCode, setCompletedCode] = useState('');
  
  // Decline & Delegate Modals
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [isDeclined, setIsDeclined] = useState(false);

  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [delegateName, setDelegateName] = useState('');
  const [delegateEmail, setDelegateEmail] = useState('');
  const [isDelegated, setIsDelegated] = useState(false);
  const [delegatedInfo, setDelegatedInfo] = useState<{ name: string; email: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    loadSession();
    initWebSocket();
  }, [token]);

  const loadSession = async () => {
    try {
      setLoading(true);
      const data = await api.getSigningSession(token);
      setSession(data);
      if (data.recipient?.name) {
        setTypedName(data.recipient.name);
      }
      // Initialize default values for date fields
      if (data.fields) {
        const initial: Record<string, string> = {};
        data.fields.forEach((f: any) => {
          if (f.field_type === 'date') {
            initial[f.id] = new Date().toISOString().split('T')[0];
          }
        });
        setFieldValues(prev => ({ ...initial, ...prev }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const initWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/signing/${token}`;
    try {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'COMPLETED' || msg.type === 'STEP_SIGNED') {
            setIsCompleted(true);
            if (msg.verification_code) setCompletedCode(msg.verification_code);
          }
        } catch (e) {}
      };
      return () => ws.close();
    } catch (e) {}
  };

  // Canvas Drawing Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e1b4b';

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const loadMobileQr = async () => {
    try {
      const data = await api.getMobileHandshake(token);
      setMobileQr(data.qr_code_base64);
    } catch (e) {}
  };

  const applySignature = () => {
    let sigData = '';
    if (sigMode === 'draw') {
      const canvas = canvasRef.current;
      if (canvas) sigData = canvas.toDataURL('image/png');
    } else if (sigMode === 'type') {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 120;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.font = 'italic 36px "Brush Script MT", cursive, sans-serif';
        ctx.fillStyle = '#1e1b4b';
        ctx.fillText(typedName || session?.recipient?.name || 'Signature', 20, 70);
        sigData = c.toDataURL('image/png');
      }
    }

    if (sigData) {
      setPrimarySignature(sigData);
      if (activeModalField) {
        setFieldValues(prev => ({ ...prev, [activeModalField]: sigData }));
      }
    }
    setActiveModalField(null);
  };

  const handleFieldValueChange = (fieldId: string, val: string) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: val }));
  };

  const handleFinalSubmit = async () => {
    try {
      setSubmitting(true);
      const signaturesPayload = Object.entries(fieldValues).map(([field_id, val]) => ({
        field_id,
        value: val
      }));

      const res = await api.submitSignatures(token, {
        signatures: signaturesPayload,
        signature_data_url: primarySignature,
        signature_type: sigMode,
      });

      setIsCompleted(true);
      setCompletedCode(res.verification_code || '');
    } catch (err: any) {
      alert(err.message || 'Signing failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declineReason.trim()) return;
    try {
      setSubmitting(true);
      await api.declineSigning(token, declineReason.trim());
      setIsDeclined(true);
      setShowDeclineModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to decline signing.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelegateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delegateName.trim() || !delegateEmail.trim()) return;
    try {
      setSubmitting(true);
      await api.delegateSigning(token, delegateName.trim(), delegateEmail.trim());
      setDelegatedInfo({ name: delegateName.trim(), email: delegateEmail.trim() });
      setIsDelegated(true);
      setShowDelegateModal(false);
    } catch (err: any) {
      alert(err.message || 'Failed to delegate signing.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-xs text-slate-400">Loading secure signing studio...</p>
      </div>
    );
  }

  if (isDeclined) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 rounded-3xl glass-card border border-rose-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 mx-auto flex items-center justify-center">
          <UserX className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Document Signing Declined</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            You have officially declined to sign this document. The document originator has been notified of your refusal.
          </p>
        </div>
        <div className="p-3 bg-slate-900/90 rounded-xl border border-white/5 text-xs text-slate-300">
          <span className="text-slate-500 block mb-1 text-[10px] uppercase font-bold tracking-wider">Reason Specified</span>
          <span>{declineReason}</span>
        </div>
      </div>
    );
  }

  if (isDelegated) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 rounded-3xl glass-card border border-indigo-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 mx-auto flex items-center justify-center">
          <UserCheck className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Authority Successfully Delegated</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Signing authority has been reassigned to <strong className="text-white">{delegatedInfo?.name}</strong> (<span className="text-indigo-300">{delegatedInfo?.email}</span>). A fresh signing link has been generated and dispatched.
          </p>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 rounded-3xl glass-card border border-emerald-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Document Successfully Sealed</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Your cryptographic digital signature has been verified and permanently affixed to the document under the Docurama Root CA Trust Network.
          </p>
        </div>
        {completedCode && (
          <div className="p-3 bg-slate-900/90 rounded-xl border border-white/5 text-xs">
            <span className="text-slate-500 block mb-1 text-[10px] uppercase font-bold tracking-wider">Verification Reference</span>
            <span className="font-mono text-emerald-400 font-bold">{completedCode}</span>
          </div>
        )}
        <div className="pt-2">
          <a
            href={`/verify?code=${completedCode}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white btn-primary-glow"
          >
            <ShieldCheck className="w-4 h-4" />
            View Public Verification Certificate
          </a>
        </div>
      </div>
    );
  }

  const fields = session?.fields || [];
  const requiredCount = fields.length;
  const filledCount = Object.keys(fieldValues).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      
      {/* Top Floating Action Bar */}
      <div className="sticky top-4 z-30 p-4 rounded-2xl glass-panel border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-white text-xs sm:text-sm">{session?.envelope_title}</div>
            <div className="text-[10px] text-slate-400">Signer: {session?.recipient?.name} ({session?.recipient?.email})</div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={() => setShowDelegateModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 bg-slate-900 border border-white/10 hover:bg-slate-800 transition-colors"
          >
            Delegate
          </button>

          <button
            onClick={() => setShowDeclineModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
          >
            Decline
          </button>

          <button
            onClick={handleFinalSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow disabled:opacity-50 shadow-lg"
          >
            <Check className="w-4 h-4" />
            {submitting ? 'Sealing Document...' : 'Finish & Seal'}
          </button>
        </div>
      </div>

      {/* Signing Document Preview Sheet */}
      <div className="relative min-h-[600px] rounded-2xl bg-white text-slate-900 p-8 sm:p-12 shadow-2xl space-y-8 select-none">
        
        <div className="border-b border-slate-200 pb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{session?.envelope_title}</h1>
            <p className="text-xs text-slate-500 mt-1">Docurama Certified Electronic Document • Clean-Room Architecture</p>
          </div>
          <div className="text-right text-[10px] text-slate-400 font-mono">
            SECURE-ID: {session?.envelope_id?.slice(0, 8)}
          </div>
        </div>

        <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
          <p>
            By executing this document through Docurama, all parties agree that electronic signatures, initials, and cryptographic timestamps affixed hereto carry the full legal validity, enforceability, and admissibility equivalent to handwritten wet signatures under eIDAS (EU 910/2014) and the US ESIGN Act.
          </p>
          <p>
            Every signature captured records hardware telemetry, high-entropy timestamps via DigiCert RFC 3161 TSA, and an immutable SHA-256 state digest permanently sealed into the PAdES-LTV layer.
          </p>
        </div>

        {/* Dynamic Fields Grid */}
        <div className="pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {fields.map((f: any) => {
            const isSigned = !!fieldValues[f.id];
            const isSigOrInitials = f.field_type === 'signature' || f.field_type === 'initials';

            if (isSigOrInitials) {
              return (
                <div 
                  key={f.id}
                  onClick={() => {
                    setActiveModalField(f.id);
                    if (sigMode === 'phone') loadMobileQr();
                  }}
                  className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                    isSigned 
                      ? 'border-emerald-400 bg-emerald-50/50' 
                      : 'border-dashed border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50/80 animate-pulse'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    {f.label || f.field_type.toUpperCase()}
                  </div>
                  {isSigned ? (
                    <div className="h-12 flex items-center justify-center">
                      <img src={fieldValues[f.id]} alt="Signature" className="max-h-10 object-contain" />
                    </div>
                  ) : (
                    <div className="h-12 flex items-center justify-center gap-2 text-xs font-bold text-indigo-600">
                      <PenTool className="w-4 h-4" />
                      Click to {f.field_type === 'initials' ? 'Initial' : 'Sign'}
                    </div>
                  )}
                </div>
              );
            }

            if (f.field_type === 'checkbox') {
              const checked = fieldValues[f.id] === 'true';
              return (
                <div key={f.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => handleFieldValueChange(f.id, e.target.checked ? 'true' : 'false')}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <label className="text-xs font-semibold text-slate-700 cursor-pointer">
                    {f.label || 'I acknowledge and agree'}
                  </label>
                </div>
              );
            }

            if (f.field_type === 'dropdown') {
              const options = f.options && f.options.length > 0 ? f.options : ['Option 1', 'Option 2'];
              return (
                <div key={f.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    {f.label || 'Select Option'}
                  </label>
                  <select
                    value={fieldValues[f.id] || ''}
                    onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Option --</option>
                    {options.map((opt: string) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (f.field_type === 'radio') {
              const options = f.options && f.options.length > 0 ? f.options : ['Option 1', 'Option 2'];
              return (
                <div key={f.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    {f.label || 'Select One'}
                  </label>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-700">
                    {options.map((opt: string) => (
                      <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`radio_${f.id}`}
                          value={opt}
                          checked={fieldValues[f.id] === opt}
                          onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                          className="text-indigo-600 focus:ring-0"
                        />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            }

            if (f.field_type === 'number') {
              return (
                <div key={f.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    {f.label || 'Number Input'}
                  </label>
                  <input
                    type="number"
                    placeholder={f.placeholder || '0'}
                    value={fieldValues[f.id] || ''}
                    onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              );
            }

            // Default: text or date
            return (
              <div key={f.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  {f.label || (f.field_type === 'date' ? 'Date Signed' : 'Text Input')}
                </label>
                <input
                  type={f.field_type === 'date' ? 'date' : 'text'}
                  placeholder={f.placeholder || ''}
                  value={fieldValues[f.id] || ''}
                  onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>
            );
          })}
        </div>

      </div>

      {/* Signature & Initials Capture Modal */}
      {activeModalField && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-6 shadow-2xl">
            
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <PenTool className="w-4 h-4 text-indigo-400" />
                Affix Your Digital Signature / Initials
              </h3>
              <button 
                onClick={() => setActiveModalField(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Select Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setSigMode('draw')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'draw' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                Draw
              </button>
              <button
                onClick={() => setSigMode('type')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'type' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Type
              </button>
              <button
                onClick={() => {
                  setSigMode('phone');
                  loadMobileQr();
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'phone' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Sign on Phone
              </button>
            </div>

            {/* Draw Mode */}
            {sigMode === 'draw' && (
              <div className="space-y-3">
                <div className="relative rounded-2xl bg-white p-2 border border-slate-300">
                  <canvas
                    ref={canvasRef}
                    width={440}
                    height={160}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-40 cursor-crosshair touch-none"
                  />
                  <button
                    onClick={clearCanvas}
                    className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 text-center">Draw with smooth pen dynamics</p>
              </div>
            )}

            {/* Type Mode */}
            {sigMode === 'type' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Type your legal full name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <div className="p-6 bg-white rounded-2xl text-center">
                  <span className="font-serif italic text-3xl text-slate-900 tracking-wide">
                    {typedName || 'Your Signature'}
                  </span>
                </div>
              </div>
            )}

            {/* Sign on Phone Mode */}
            {sigMode === 'phone' && (
              <div className="text-center p-4 space-y-4">
                <div className="w-48 h-48 bg-white p-3 rounded-2xl mx-auto shadow-lg flex items-center justify-center">
                  {mobileQr ? (
                    <img src={mobileQr} alt="Scan QR Code to Sign on Phone" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Scan to Sign on Phone</div>
                  <div className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                    Point your camera at this QR code. Sign on touch screen and watch your desktop update in real-time.
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                onClick={() => setActiveModalField(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              {sigMode !== 'phone' && (
                <button
                  onClick={applySignature}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow"
                >
                  Adopt & Sign
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Decline Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                Decline to Sign Document
              </h3>
              <button onClick={() => setShowDeclineModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Please specify the reason you are refusing to execute this agreement. The sender will be informed immediately.
            </p>
            <form onSubmit={handleDeclineSubmit} className="space-y-4">
              <textarea
                required
                rows={3}
                placeholder="Reason for declining..."
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeclineModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors"
                >
                  Confirm Decline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delegate Modal */}
      {showDelegateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/10 p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-400" />
                Delegate Signing Authority
              </h3>
              <button onClick={() => setShowDelegateModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Reassign your signature duties to another authorized representative in your organization.
            </p>
            <form onSubmit={handleDelegateSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Delegate Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Connor"
                  value={delegateName}
                  onChange={(e) => setDelegateName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Delegate Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. sarah@enterprise.com"
                  value={delegateEmail}
                  onChange={(e) => setDelegateEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-white/10 text-xs text-white"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDelegateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow"
                >
                  Confirm Delegation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
