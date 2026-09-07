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
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronLeft,
  ArrowDown,
  Layers,
  FileText,
  Sparkles,
  Shield
} from 'lucide-react';
import { api, DocumentPage } from '../lib/api';

interface SigningStudioPageProps {
  token: string;
  onDone?: () => void;
}

const HANDWRITING_FONTS = [
  { id: 'dancing', name: 'Executive Script', fontFamily: "'Dancing Script', cursive" },
  { id: 'caveat', name: 'Modern Signature', fontFamily: "'Caveat', cursive" },
  { id: 'greatvibes', name: 'Classic Calligraphy', fontFamily: "'Great Vibes', cursive" },
  { id: 'brush', name: 'Casual Pen', fontFamily: "'Brush Script MT', cursive, sans-serif" },
];

export const SigningStudioPage: React.FC<SigningStudioPageProps> = ({ token, onDone }) => {
  const [session, setSession] = useState<any>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [activeModalField, setActiveModalField] = useState<string | null>(null);
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'phone'>('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(HANDWRITING_FONTS[0].fontFamily);
  const [primarySignature, setPrimarySignature] = useState<string>('');
  const [mobileQr, setMobileQr] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedCode, setCompletedCode] = useState('');
  
  // Viewport & Navigation
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [showThumbnails, setShowThumbnails] = useState<boolean>(true);
  const [highlightedFieldId, setHighlightedFieldId] = useState<string | null>(null);
  const [showSecurityModal, setShowSecurityModal] = useState<boolean>(false);

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
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    loadSessionAndPages();
    initWebSocket();
  }, [token]);

  const loadSessionAndPages = async () => {
    try {
      setLoading(true);
      const [sessionData, pagesData] = await Promise.all([
        api.getSigningSession(token),
        api.getSigningPages(token).catch(() => ({ page_count: 0, pages: [] }))
      ]);

      setSession(sessionData);
      setPages(pagesData.pages || []);

      if (sessionData.recipient?.name) {
        setTypedName(sessionData.recipient.name);
      }

      // Initialize default values for date fields
      if (sessionData.fields) {
        const initial: Record<string, string> = {};
        sessionData.fields.forEach((f: any) => {
          if (f.field_type === 'date' && !initial[f.id]) {
            initial[f.id] = new Date().toISOString().split('T')[0];
          }
        });
        setFieldValues(prev => ({ ...initial, ...prev }));
      }
    } catch (err) {
      console.error('Failed to load signing session:', err);
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
          } else if (msg.type === 'SIGNATURE_CAPTURED' && msg.signature_data_url) {
            setPrimarySignature(msg.signature_data_url);
            if (activeModalField) {
              setFieldValues(prev => ({ ...prev, [activeModalField]: msg.signature_data_url }));
              setActiveModalField(null);
            }
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
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';

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
      c.width = 500;
      c.height = 140;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.font = `italic 38px ${selectedFont}`;
        ctx.fillStyle = '#0f172a';
        ctx.textBaseline = 'middle';
        ctx.fillText(typedName || session?.recipient?.name || 'Signature', 25, 70);
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
    if (unfilledRequiredFields.length > 0) {
      handleNextField();
      return;
    }

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

  // Field helpers
  const fields = session?.fields || [];
  const isMyField = (f: any) => {
    if (!session?.recipient) return true;
    return !f.recipient_id || f.recipient_id === session.recipient.id;
  };

  const myFields = fields.filter((f: any) => isMyField(f));
  const myRequiredFields = myFields.filter((f: any) => f.required);
  const unfilledRequiredFields = myRequiredFields.filter((f: any) => !fieldValues[f.id]);
  const totalRequired = myRequiredFields.length;
  const filledCount = totalRequired - unfilledRequiredFields.length;
  const progressPercent = totalRequired > 0 ? Math.round((filledCount / totalRequired) * 100) : 100;

  // Guided Navigation
  const handleNextField = () => {
    const nextField = unfilledRequiredFields[0];
    if (nextField) {
      scrollToField(nextField.id);
      if (nextField.field_type === 'signature' || nextField.field_type === 'initials') {
        setActiveModalField(nextField.id);
        if (sigMode === 'phone') loadMobileQr();
      }
    } else {
      handleFinalSubmit();
    }
  };

  const scrollToField = (fieldId: string) => {
    const el = fieldRefs.current[fieldId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedFieldId(fieldId);
      setTimeout(() => setHighlightedFieldId(null), 3000);
    }
  };

  const scrollToPage = (pageNum: number) => {
    setActivePageNumber(pageNum);
    const el = pageRefs.current[pageNum];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Zoom calculation
  const baseWidth = 800;
  const renderedWidth = Math.round(baseWidth * (zoomLevel / 100));

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 rounded-full border-3 border-indigo-500 border-t-transparent animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-white">Loading Secure Signing Studio...</p>
          <p className="text-xs text-slate-400 mt-1">Rendering high-resolution document pages & cryptographic layers</p>
        </div>
      </div>
    );
  }

  if (isDeclined) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl glass-card border border-rose-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-2xl">
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
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl glass-card border border-indigo-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-2xl">
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
      <div className="max-w-lg mx-auto my-16 p-8 sm:p-10 rounded-3xl glass-card border border-emerald-500/30 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mx-auto flex items-center justify-center shadow-lg shadow-emerald-500/20">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <div>
          <span className="px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-block mb-3">
            Legally Binding • eIDAS & ESIGN Compliant
          </span>
          <h2 className="text-2xl font-bold text-white">Document Successfully Sealed</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Your cryptographic digital signature has been verified and permanently affixed to the document under the Docurama Root CA Trust Network.
          </p>
        </div>

        {completedCode && (
          <div className="p-4 bg-slate-900/90 rounded-2xl border border-white/5 text-xs text-left space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 text-[11px] font-semibold">Verification Code</span>
              <span className="font-mono text-emerald-400 font-bold text-sm tracking-wider">{completedCode}</span>
            </div>
            <div className="text-[10px] text-slate-500 flex items-center gap-1.5 pt-1 border-t border-white/5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>SHA-256 Digest Recorded in PAdES-LTV Certificate</span>
            </div>
          </div>
        )}

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href={`/verify?code=${completedCode}`}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-bold text-white btn-primary-glow"
          >
            <ShieldCheck className="w-4 h-4" />
            View Public Verification Certificate
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] overflow-hidden">
      
      {/* Top Sticky Header & Controls */}
      <div className="p-3 sm:p-4 rounded-2xl glass-panel border border-white/10 flex flex-wrap items-center justify-between gap-3 shadow-xl mb-3 shrink-0">
        
        {/* Document Info */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-white text-xs sm:text-sm flex items-center gap-2">
              <span>{session?.envelope_title}</span>
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Secure Session
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Signer: <span className="text-white font-medium">{session?.recipient?.name}</span> ({session?.recipient?.email})
            </div>
          </div>
        </div>

        {/* Center: Zoom Controls & Thumbnail Toggle */}
        <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setShowThumbnails(!showThumbnails)}
            title="Toggle Page Rail"
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              showThumbnails ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          <div className="h-3 w-px bg-white/10 mx-1" />
          <button
            onClick={() => setZoomLevel(Math.max(60, zoomLevel - 15))}
            disabled={zoomLevel <= 60}
            title="Zoom Out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-[11px] font-mono font-bold text-slate-300 min-w-[44px] text-center">
            {zoomLevel}%
          </span>
          <button
            onClick={() => setZoomLevel(Math.min(160, zoomLevel + 15))}
            disabled={zoomLevel >= 160}
            title="Zoom In"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(100)}
            title="Reset Zoom (100%)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white text-[10px] font-mono transition-colors"
          >
            100%
          </button>
        </div>

        {/* Right Actions: Delegate, Decline, Finish */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSecurityModal(true)}
            title="Security Audit & Compliance"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white bg-slate-900 border border-white/10 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px]">Audit Info</span>
          </button>

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
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg ${
              unfilledRequiredFields.length === 0
                ? 'btn-primary-glow animate-bounce-subtle'
                : 'bg-indigo-600/80 hover:bg-indigo-600'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>{submitting ? 'Sealing...' : 'Finish & Seal'}</span>
          </button>
        </div>

      </div>

      {/* Main Studio Body: Thumbnails + Document Canvas */}
      <div className="flex-1 flex overflow-hidden rounded-2xl border border-white/10 relative">
        
        {/* Left Page Thumbnails Rail */}
        {showThumbnails && pages.length > 0 && (
          <div className="w-36 bg-slate-900/95 border-r border-white/10 p-3 overflow-y-auto space-y-3 shrink-0 flex flex-col">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block px-1">
              Pages ({pages.length})
            </span>
            <div className="space-y-2.5 flex-1">
              {pages.map((p) => {
                const isActive = activePageNumber === p.page_number;
                const pageFieldsCount = myFields.filter((f: any) => f.page_number === p.page_number).length;

                return (
                  <div
                    key={p.page_number}
                    onClick={() => scrollToPage(p.page_number)}
                    className={`cursor-pointer group rounded-xl overflow-hidden border-2 transition-all relative ${
                      isActive 
                        ? 'border-indigo-500 ring-2 ring-indigo-500/40 shadow-lg' 
                        : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <div className="relative bg-white aspect-[0.77] overflow-hidden">
                      <img
                        src={p.url}
                        alt={`Page ${p.page_number}`}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-bold text-white font-mono">
                        #{p.page_number}
                      </span>
                      {pageFieldsCount > 0 && (
                        <span className="absolute top-1 left-1 px-1 py-0.2 rounded-full bg-indigo-600 text-[8px] font-bold text-white flex items-center justify-center min-w-[16px]">
                          {pageFieldsCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Central Scrollable Document Canvas */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-950 flex flex-col items-center bg-dot-pattern relative">
          
          {pages.length > 0 ? (
            pages.map((page: DocumentPage) => {
              const pageFields = fields.filter((f: any) => f.page_number === page.page_number);

              return (
                <div
                  key={page.page_number}
                  ref={(el) => (pageRefs.current[page.page_number] = el)}
                  style={{ width: `${renderedWidth}px` }}
                  className="relative shadow-2xl rounded-sm bg-white mb-10 border border-slate-700/60 select-none transition-all group"
                >
                  {/* Page Indicator Tag */}
                  <div className="absolute -top-6 left-0 text-[10px] font-mono text-slate-400 font-bold flex items-center gap-2">
                    <span>Page {page.page_number} of {pages.length}</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-slate-500 font-sans">Docurama Certified Rendering</span>
                  </div>

                  {/* PyMuPDF High-Res Page Image */}
                  <img
                    src={page.url}
                    alt={`Page ${page.page_number}`}
                    className="w-full h-auto block select-none pointer-events-none"
                  />

                  {/* Overlay Fields Layer */}
                  <div className="absolute inset-0 z-10 pointer-events-none">
                    {pageFields.map((f: any) => {
                      const mine = isMyField(f);
                      const isSignedOrFilled = !!fieldValues[f.id];
                      const isSigOrInitials = f.field_type === 'signature' || f.field_type === 'initials';
                      const isHighlighted = highlightedFieldId === f.id;

                      if (!mine) {
                        // Belongs to another party
                        return (
                          <div
                            key={f.id}
                            style={{
                              left: `${f.x}%`,
                              top: `${f.y}%`,
                              width: `${f.width}%`,
                              minHeight: '34px',
                            }}
                            className="absolute rounded border border-dashed border-slate-400/60 bg-slate-200/40 p-1 pointer-events-auto flex items-center justify-center text-[10px] text-slate-500 font-medium"
                          >
                            <span>Assigned to other party</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={f.id}
                          ref={(el) => (fieldRefs.current[f.id] = el)}
                          style={{
                            left: `${f.x}%`,
                            top: `${f.y}%`,
                            width: `${f.width}%`,
                            minHeight: '36px',
                          }}
                          className={`absolute rounded-lg transition-all pointer-events-auto cursor-pointer ${
                            isHighlighted ? 'ring-4 ring-indigo-400 ring-offset-2 z-30' : 'z-20'
                          }`}
                        >
                          {isSigOrInitials ? (
                            <div
                              onClick={() => {
                                setActiveModalField(f.id);
                                if (sigMode === 'phone') loadMobileQr();
                              }}
                              className={`w-full h-full p-1.5 rounded-lg border-2 transition-all flex items-center justify-between ${
                                isSignedOrFilled
                                  ? 'border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
                                  : 'border-indigo-500 bg-indigo-500/15 hover:bg-indigo-500/25 animate-pulse shadow-md shadow-indigo-500/20'
                              }`}
                            >
                              {isSignedOrFilled ? (
                                <div className="w-full flex items-center justify-between">
                                  <img
                                    src={fieldValues[f.id]}
                                    alt="Affixed Signature"
                                    className="max-h-8 object-contain"
                                  />
                                  <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 bg-white/90 px-1.5 py-0.5 rounded shadow-sm">
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>Signed</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="w-full flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700">
                                    <PenTool className="w-3.5 h-3.5 text-indigo-600" />
                                    <span className="text-[11px] uppercase tracking-wider">
                                      {f.label || (f.field_type === 'initials' ? 'Initial Here' : 'Sign Here')}
                                    </span>
                                  </div>
                                  {f.required && (
                                    <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-wider bg-rose-500 text-white">
                                      Required
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : f.field_type === 'checkbox' ? (
                            <div
                              onClick={() => handleFieldValueChange(f.id, fieldValues[f.id] === 'true' ? 'false' : 'true')}
                              className={`w-full h-full p-2 rounded-lg border-2 flex items-center gap-2 bg-white/95 shadow-sm transition-all ${
                                fieldValues[f.id] === 'true'
                                  ? 'border-emerald-500 text-emerald-700'
                                  : 'border-slate-300 text-slate-700 hover:border-indigo-400'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                                fieldValues[f.id] === 'true' ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-400 bg-white'
                              }`}>
                                {fieldValues[f.id] === 'true' && <Check className="w-3 h-3" />}
                              </div>
                              <span className="text-[11px] font-medium truncate">{f.label || 'Agree'}</span>
                            </div>
                          ) : f.field_type === 'dropdown' ? (
                            <div className="w-full h-full p-1 bg-white rounded-lg border-2 border-indigo-400/80 shadow-sm">
                              <select
                                value={fieldValues[f.id] || ''}
                                onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                                className="w-full h-full bg-transparent text-xs text-slate-800 focus:outline-none cursor-pointer"
                              >
                                <option value="">-- {f.label || 'Choose Option'} --</option>
                                {(f.options && f.options.length > 0 ? f.options : ['Option 1', 'Option 2']).map((opt: string) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                          ) : f.field_type === 'radio' ? (
                            <div className="w-full h-full p-1.5 bg-white/95 rounded-lg border-2 border-indigo-400/80 shadow-sm flex items-center gap-3">
                              {(f.options && f.options.length > 0 ? f.options : ['Option 1', 'Option 2']).map((opt: string) => (
                                <label key={opt} className="flex items-center gap-1 text-[11px] text-slate-800 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`radio_${f.id}`}
                                    value={opt}
                                    checked={fieldValues[f.id] === opt}
                                    onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                                    className="text-indigo-600 focus:ring-0"
                                  />
                                  <span className="truncate">{opt}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            /* Text, Date, or Number input */
                            <div className="w-full h-full bg-white/95 rounded-lg border-2 border-indigo-400/80 shadow-sm p-1 flex items-center">
                              <input
                                type={f.field_type === 'date' ? 'date' : f.field_type === 'number' ? 'number' : 'text'}
                                placeholder={f.placeholder || f.label || (f.field_type === 'date' ? 'YYYY-MM-DD' : 'Type here...')}
                                value={fieldValues[f.id] || ''}
                                onChange={(e) => handleFieldValueChange(f.id, e.target.value)}
                                className="w-full h-full bg-transparent px-2 text-xs font-medium text-slate-900 focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                </div>
              );
            })
          ) : (
            /* Fallback single-sheet view if no rasterized pages returned */
            <div 
              style={{ width: `${renderedWidth}px` }} 
              className="bg-white rounded-xl shadow-2xl p-10 text-slate-900 space-y-6 select-none"
            >
              <div className="border-b border-slate-200 pb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{session?.envelope_title}</h2>
                  <p className="text-xs text-slate-500">Docurama Certified Document</p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 font-bold">SECURE-PADES</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                By executing this document through Docurama, all parties agree that electronic signatures, initials, and cryptographic timestamps affixed hereto carry the full legal validity under eIDAS (EU 910/2014) and US ESIGN Act.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                {myFields.map((f: any) => (
                  <div
                    key={f.id}
                    onClick={() => {
                      if (f.field_type === 'signature' || f.field_type === 'initials') {
                        setActiveModalField(f.id);
                        if (sigMode === 'phone') loadMobileQr();
                      }
                    }}
                    className="p-4 rounded-xl border-2 border-indigo-400 bg-indigo-50/50 cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-slate-500 uppercase">{f.label || f.field_type}</div>
                    {fieldValues[f.id] ? (
                      <img src={fieldValues[f.id]} alt="Signature" className="h-10 object-contain mt-2" />
                    ) : (
                      <div className="text-xs font-bold text-indigo-600 mt-2 flex items-center gap-1.5">
                        <PenTool className="w-4 h-4" /> Click to Sign
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Floating Guided Next Field Assistant */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-white/15 px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-5">
        <div className="flex items-center gap-2.5">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-800"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-indigo-500 transition-all duration-500"
                strokeDasharray={`${progressPercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-[8px] font-bold font-mono text-white">{progressPercent}%</span>
          </div>
          <div className="text-xs">
            <div className="font-bold text-white leading-none">
              {unfilledRequiredFields.length > 0 
                ? `${unfilledRequiredFields.length} field${unfilledRequiredFields.length > 1 ? 's' : ''} left` 
                : 'All fields completed!'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {filledCount} of {totalRequired} required filled
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        {unfilledRequiredFields.length > 0 ? (
          <button
            onClick={handleNextField}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold text-white btn-primary-glow shadow-md"
          >
            <span>Next Field</span>
            <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
          </button>
        ) : (
          <button
            onClick={handleFinalSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/30 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Finish & Seal</span>
          </button>
        )}
      </div>

      {/* Signature / Initials Capture Modal */}
      {activeModalField && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-white/15 p-6 space-y-5 shadow-2xl">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <PenTool className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Affix Digital Signature & Cryptographic Seal
                  </h3>
                  <p className="text-[10px] text-slate-400">Docurama Root CA Trust Framework</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveModalField(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-white/10">
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
                <div className="relative rounded-2xl bg-white p-2 border border-slate-300 shadow-inner">
                  <canvas
                    ref={canvasRef}
                    width={480}
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
                    className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center gap-1 shadow-sm transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Clear
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                  <span>Draw using mouse, stylus or touchpad</span>
                  <span className="text-indigo-400 font-medium">Vector Smoothing Active</span>
                </div>
              </div>
            )}

            {/* Type Mode with handwriting font selector */}
            {sigMode === 'type' && (
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Type your legal full name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 shadow-inner"
                />

                <div className="grid grid-cols-2 gap-2">
                  {HANDWRITING_FONTS.map(f => {
                    const isSelected = selectedFont === f.fontFamily;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFont(f.fontFamily)}
                        style={{ fontFamily: f.fontFamily }}
                        className={`p-3 rounded-xl text-left bg-white text-slate-900 text-xl truncate border-2 transition-all ${
                          isSelected ? 'border-indigo-600 ring-2 ring-indigo-500/40 shadow-md' : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {typedName || session?.recipient?.name || 'Your Signature'}
                      </button>
                    );
                  })}
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
                  <div className="text-xs font-bold text-white">Scan to Sign on Mobile Touchscreen</div>
                  <div className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                    Point your camera at this QR code. Sign smoothly on your mobile touch screen and watch your desktop update in real-time.
                  </div>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                onClick={() => setActiveModalField(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              {sigMode !== 'phone' && (
                <button
                  onClick={applySignature}
                  className="px-6 py-2 rounded-xl text-xs font-bold text-white btn-primary-glow shadow-md"
                >
                  Adopt & Sign
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Legal & Security Compliance Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/15 p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Document Legal Validity & Security</h3>
              </div>
              <button onClick={() => setShowSecurityModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">eIDAS & ESIGN Compliance</span>
                <p className="text-[11px] text-slate-400">
                  Electronic signatures executed via Docurama carry full legal validity, enforceability, and court admissibility under EU Regulation 910/2014 and the US ESIGN Act of 2000.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Cryptographic PAdES-LTV Seal</span>
                <p className="text-[11px] text-slate-400">
                  Each finalized document is sealed with an immutable SHA-256 state digest and embedded cryptographic certificates providing Long-Term Validation (LTV) independent of Docurama servers.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">RFC 3161 Certified Timestamping</span>
                <p className="text-[11px] text-slate-400">
                  Every signature record captures hardware telemetry, IP address, and high-entropy timestamping issued by certified Trust Service Providers.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowSecurityModal(false)}
              className="w-full py-2 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Decline Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
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
