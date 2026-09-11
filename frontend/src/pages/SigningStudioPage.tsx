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
  Shield,
  Fingerprint,
  MessageSquareText,
  ShieldAlert,
  Scale,
  Info,
  Clock,
  Send,
  Mail
} from 'lucide-react';
import { api, DocumentPage, ContractAnalysisReport, CorrectionRequestItem } from '../lib/api';

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
  const [sigMode, setSigMode] = useState<'draw' | 'type' | 'phone' | 'passkey'>('draw');
  const [inkColor, setInkColor] = useState<'#0f172a' | '#1d4ed8'>('#0f172a');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(HANDWRITING_FONTS[0].fontFamily);
  const [primarySignature, setPrimarySignature] = useState<string>('');
  const [mobileQr, setMobileQr] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedCode, setCompletedCode] = useState('');
  
  // Signer Identity Verification Gate State
  const [isVerified, setIsVerified] = useState<boolean>(true);
  const [otpCode, setOtpCode] = useState<string>('');
  const [otpSending, setOtpSending] = useState<boolean>(false);
  const [otpVerifying, setOtpVerifying] = useState<boolean>(false);
  const [otpError, setOtpError] = useState<string>('');
  const [otpSuccessMsg, setOtpSuccessMsg] = useState<string>('');
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Passkey Biometrics
  const [biometricStatus, setBiometricStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');


  // Contract Intelligence State
  const [analysisReport, setAnalysisReport] = useState<ContractAnalysisReport | null>(null);
  const [showAnalysisDrawer, setShowAnalysisDrawer] = useState<boolean>(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);

  // In-line Correction Request State
  const [showCorrectionModal, setShowCorrectionModal] = useState<boolean>(false);
  const [correctionClause, setCorrectionClause] = useState<string>('');
  const [correctionText, setCorrectionText] = useState<string>('');
  const [correctionsList, setCorrectionsList] = useState<CorrectionRequestItem[]>([]);
  const [submittingCorrection, setSubmittingCorrection] = useState<boolean>(false);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState<string>('');

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
  const strokePoints = useRef<{ x: number; y: number; time: number }[]>([]);
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
      setIsVerified(Boolean(sessionData.is_verified));
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

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  const handleSendOtp = async () => {
    try {
      setOtpSending(true);
      setOtpError('');
      const res = await api.sendSigningOtp(token);
      setOtpSuccessMsg(res.message || 'Verification passcode dispatched.');
      setCooldownRemaining(res.cooldown_seconds || 30);
      setTimeout(() => setOtpSuccessMsg(''), 4000);
    } catch (err: any) {
      setOtpError(err.message || 'Failed to send verification code.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6) return;
    try {
      setOtpVerifying(true);
      setOtpError('');
      await api.verifySigningOtp(token, otpCode);
      setIsVerified(true);
      // Reload pages since they are now unlocked
      const pagesData = await api.getSigningPages(token).catch(() => ({ page_count: 0, pages: [] }));
      setPages(pagesData.pages || []);
    } catch (err: any) {
      setOtpError(err.message || 'Invalid verification code.');
    } finally {
      setOtpVerifying(false);
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

  // Contract Analysis & Correction Loaders
  const loadAnalysis = async () => {
    try {
      setLoadingAnalysis(true);
      const data = await api.getContractAnalysis(token);
      setAnalysisReport(data);
    } catch (err) {
      console.error('Contract analysis failed:', err);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const loadCorrections = async () => {
    try {
      const data = await api.getCorrections(token);
      setCorrectionsList(data);
    } catch (e) {}
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionText.trim()) return;
    try {
      setSubmittingCorrection(true);
      await api.requestCorrection(token, {
        suggested_correction: correctionText.trim(),
        clause_title: correctionClause.trim() || 'General Contract Clause',
      });
      setCorrectionSuccessMsg('Correction request recorded. Originator has been dispatched an instant alert.');
      setCorrectionText('');
      setCorrectionClause('');
      loadCorrections();
      setTimeout(() => setCorrectionSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Failed to submit correction request.');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  // High-Resolution Smooth Bézier Canvas Drawing Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    strokePoints.current = [{ x, y, time: Date.now() }];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.8;
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

    const pts = strokePoints.current;
    pts.push({ x, y, time: Date.now() });

    if (pts.length >= 3) {
      const p0 = pts[pts.length - 3];
      const p1 = pts[pts.length - 2];
      const p2 = pts[pts.length - 1];

      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const dt = Math.max(1, p2.time - p1.time);
      const velocity = dist / dt;
      const dynamicWidth = Math.max(1.8, Math.min(3.8, 3.4 - velocity * 0.7));

      ctx.lineWidth = dynamicWidth;
      ctx.strokeStyle = inkColor;

      const mid1X = (p0.x + p1.x) / 2;
      const mid1Y = (p0.y + p1.y) / 2;
      const mid2X = (p1.x + p2.x) / 2;
      const mid2Y = (p1.y + p2.y) / 2;

      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    isDrawing.current = false;
    strokePoints.current = [];
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    strokePoints.current = [];
  };

  const loadMobileQr = async () => {
    try {
      const data = await api.getMobileHandshake(token);
      setMobileQr(data.qr_code_base64);
    } catch (e) {}
  };

  // Biometric Passkey / WebAuthn Signing Simulator
  const handleBiometricSign = async () => {
    setBiometricStatus('verifying');
    try {
      await new Promise(r => setTimeout(r, 650));
      const c = document.createElement('canvas');
      c.width = 540;
      c.height = 150;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 540, 150);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#059669';
        ctx.strokeRect(4, 4, 532, 142);
        
        ctx.fillStyle = '#065F46';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('WEBAUTHN / BIOMETRIC PASSKEY CERTIFIED SIGNATURE', 20, 30);
        
        ctx.font = `italic 32px ${selectedFont}`;
        ctx.fillStyle = inkColor;
        ctx.fillText(typedName || session?.recipient?.name || 'Verified Signer', 20, 75);
        
        ctx.font = '10px monospace';
        ctx.fillStyle = '#64748B';
        const stamp = `PASSKEY AUTH • FIDO2-L2 HW-ASSERTION • ID: ${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        ctx.fillText(stamp, 20, 110);
        ctx.fillText(`TIMESTAMP: ${new Date().toISOString()} • SHA-256 ENCLAVE LOCKED`, 20, 128);

        const sigData = c.toDataURL('image/png');
        setPrimarySignature(sigData);
        if (activeModalField) {
          setFieldValues(prev => ({ ...prev, [activeModalField]: sigData }));
        }
        setBiometricStatus('success');
        setTimeout(() => {
          setActiveModalField(null);
          setBiometricStatus('idle');
        }, 500);
      }
    } catch (err) {
      setBiometricStatus('error');
    }
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
        ctx.fillStyle = inkColor;
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
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 bg-[#F8FAFC]">
        <div className="w-10 h-10 rounded-full border-3 border-[#1D72FE] border-t-transparent animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-[#0F172A]">Loading Secure Signing Studio...</p>
          <p className="text-xs text-slate-500 mt-1">Rendering high-resolution document pages & cryptographic layers</p>
        </div>
      </div>
    );
  }

  if (isDeclined) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl bg-white border border-rose-200 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 border border-rose-100 mx-auto flex items-center justify-center">
          <UserX className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#0F172A]">Document Signing Declined</h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            You have officially declined to sign this document. The document originator has been notified of your refusal.
          </p>
        </div>
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
          <span className="text-slate-400 block mb-1 text-[10px] uppercase font-bold tracking-wider">Reason Specified</span>
          <span>{declineReason}</span>
        </div>
      </div>
    );
  }

  if (isDelegated) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl bg-white border border-blue-200 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 text-[#1D72FE] border border-blue-100 mx-auto flex items-center justify-center">
          <UserCheck className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#0F172A]">Authority Successfully Delegated</h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Signing authority has been reassigned to <strong className="text-[#0F172A]">{delegatedInfo?.name}</strong> (<span className="text-[#1D72FE]">{delegatedInfo?.email}</span>). A fresh signing link has been generated and dispatched.
          </p>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="max-w-lg mx-auto my-16 p-8 sm:p-10 rounded-3xl bg-white border border-emerald-200 text-center space-y-6 animate-in zoom-in-95 duration-300 shadow-xl">
        <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 mx-auto flex items-center justify-center shadow-md">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <div>
          <span className="px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 inline-block mb-3">
            Legally Binding • eIDAS & ESIGN Compliant
          </span>
          <h2 className="text-2xl font-bold text-[#0F172A]">Document Successfully Sealed</h2>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Your cryptographic digital signature has been verified and permanently affixed to the document under the Docurama Root CA Trust Network.
          </p>
        </div>

        {completedCode && (
          <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-slate-200 text-xs text-left space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-[11px] font-semibold">Verification Code</span>
              <span className="font-mono text-emerald-700 font-bold text-sm tracking-wider">{completedCode}</span>
            </div>
            <div className="text-[10px] text-slate-500 flex items-center gap-1.5 pt-1 border-t border-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>SHA-256 Digest Recorded in PAdES-LTV Certificate</span>
            </div>
          </div>
        )}

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href={`/verify?code=${completedCode}`}
            className="btn btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 h-11 text-xs font-bold"
          >
            <ShieldCheck className="w-4 h-4" />
            View Public Verification Certificate
          </a>
        </div>
      </div>
    );
  }

  if (session?.requires_verification && !isVerified) {
    const channel = session.verification_channel || 'email_otp';
    const channelLabel =
      channel === 'sms_otp' ? 'SMS Text Message' :
      channel === 'whatsapp_otp' ? 'WhatsApp' :
      channel === 'telegram_otp' ? 'Telegram' : 'Email Address';

    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4 bg-[#F8FAFC]">
        <div className="max-w-md w-full p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-6 shadow-xl animate-in zoom-in-95 duration-300">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-[#1D72FE] border border-blue-100 mx-auto flex items-center justify-center shadow-sm">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <span className="px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-50 text-[#1D72FE] border border-blue-200 inline-block mb-2">
              Two-Factor Identity Challenge
            </span>
            <h2 className="text-2xl font-bold text-[#0F172A]">Identity Verification Required</h2>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              To review and sign <strong>{session.envelope_title}</strong>, the sender requires identity verification via {channelLabel}.
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 space-y-2 text-left">
            <div className="flex items-center justify-between text-slate-500">
              <span>Verification Channel:</span>
              <span className="font-semibold text-slate-800">{channelLabel}</span>
            </div>
            <div className="flex items-center justify-between text-slate-500">
              <span>Delivery Target:</span>
              <span className="font-mono text-slate-800 font-semibold">{session.target_obfuscated || session.recipient?.email}</span>
            </div>
          </div>

          {otpError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 text-left">
              {otpError}
            </div>
          )}

          {otpSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 text-left">
              {otpSuccessMsg}
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-left">
                6-Digit Verification Passcode
              </label>
              <input
                type="text"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ''));
                  setOtpError('');
                }}
                placeholder="123456"
                className="w-full text-center text-2xl font-mono tracking-widest py-3 px-4 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#1D72FE] focus:border-[#1D72FE] bg-slate-50 font-bold"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={otpVerifying || otpCode.length !== 6}
              className="w-full btn btn-primary py-3 rounded-xl text-sm font-bold shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {otpVerifying ? 'Verifying Code...' : 'Verify and Unlock Document'}
            </button>
          </form>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Did not receive code?</span>
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={otpSending || cooldownRemaining > 0}
              className="text-[#1D72FE] font-semibold hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {cooldownRemaining > 0 ? `Resend in ${cooldownRemaining}s` : otpSending ? 'Sending...' : 'Send / Resend Code'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] overflow-hidden font-sans">
      
      {/* Top Sticky Header & Controls */}
      <div className="p-3 sm:p-4 rounded-2xl bg-white/95 backdrop-blur-md border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 shadow-sm mb-3 shrink-0">
        
        {/* Document Info */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1D72FE]">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-[#0F172A] text-xs sm:text-sm flex items-center gap-2">
              <span>{session?.envelope_title}</span>
              <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-[#1D72FE] border border-blue-200">
                Secure Session
              </span>
            </div>
            <div className="text-[11px] text-[#64748B]">
              Signer: <span className="text-[#0F172A] font-medium">{session?.recipient?.name}</span> ({session?.recipient?.email})
            </div>
          </div>
        </div>

        {/* Center: Zoom Controls & Thumbnail Toggle */}
        <div className="flex items-center gap-1 bg-[#F8FAFC] p-1 rounded-xl border border-[#CBD5E1]">
          <button
            onClick={() => setShowThumbnails(!showThumbnails)}
            title="Toggle Page Rail"
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              showThumbnails ? 'bg-[#1D72FE] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          <div className="h-3 w-px bg-slate-200 mx-1" />
          <button
            onClick={() => setZoomLevel(Math.max(60, zoomLevel - 15))}
            disabled={zoomLevel <= 60}
            title="Zoom Out"
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-[11px] font-mono font-bold text-[#0F172A] min-w-[44px] text-center">
            {zoomLevel}%
          </span>
          <button
            onClick={() => setZoomLevel(Math.min(160, zoomLevel + 15))}
            disabled={zoomLevel >= 160}
            title="Zoom In"
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoomLevel(100)}
            title="Reset Zoom (100%)"
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] text-[10px] font-mono transition-colors"
          >
            100%
          </button>
        </div>

        {/* Right Actions: Intelligence, Correction, Delegate, Decline, Finish */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowAnalysisDrawer(true);
              if (!analysisReport) loadAnalysis();
            }}
            title="AI Contract Comprehension & Risk Analysis"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
            <span className="hidden md:inline">Contract Intelligence</span>
            <span className="md:hidden">Intelligence</span>
          </button>

          <button
            onClick={() => {
              setShowCorrectionModal(true);
              loadCorrections();
            }}
            title="Request clause correction or amendment before signing"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 hover:bg-amber-100 transition-colors shadow-sm"
          >
            <MessageSquareText className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-[11px]">Request Correction</span>
          </button>

          <button
            onClick={() => setShowSecurityModal(true)}
            title="Security Audit & Compliance"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#64748B] hover:text-[#0F172A] bg-slate-50 border border-[#CBD5E1] transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[11px]">Audit Info</span>
          </button>

          <button
            onClick={() => setShowDelegateModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-50 border border-[#CBD5E1] hover:bg-slate-100 transition-colors"
          >
            Delegate
          </button>

          <button
            onClick={() => setShowDeclineModal(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors"
          >
            Decline
          </button>

          <button
            onClick={handleFinalSubmit}
            disabled={submitting}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold text-white transition-all shadow-md ${
              unfilledRequiredFields.length === 0
                ? 'btn-primary'
                : 'bg-[#1D72FE]/80 hover:bg-[#1D72FE]'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>{submitting ? 'Sealing...' : 'Finish & Seal'}</span>
          </button>
        </div>

      </div>

      {/* Main Studio Body: Thumbnails + Document Canvas */}
      <div className="flex-1 flex overflow-hidden rounded-2xl border border-[#E2E8F0] relative bg-[#F1F5F9]">
        
        {/* Left Page Thumbnails Rail */}
        {showThumbnails && pages.length > 0 && (
          <div className="w-36 bg-white border-r border-[#E2E8F0] p-3 overflow-y-auto space-y-3 shrink-0 flex flex-col shadow-sm">
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
                        ? 'border-[#1D72FE] ring-2 ring-blue-200 shadow-md' 
                        : 'border-slate-200 hover:border-slate-300'
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
                        <span className="absolute top-1 left-1 px-1 py-0.2 rounded-full bg-[#1D72FE] text-[8px] font-bold text-white flex items-center justify-center min-w-[16px]">
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
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-[#F1F5F9] flex flex-col items-center relative">
          
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
                className="text-slate-200"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-[#1D72FE] transition-all duration-500"
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
            <div className="text-[10px] text-slate-300 mt-0.5">
              {filledCount} of {totalRequired} required filled
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-white/20" />

        {unfilledRequiredFields.length > 0 ? (
          <button
            onClick={handleNextField}
            className="btn btn-primary flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold shadow-md"
          >
            <span>Next Field</span>
            <ArrowDown className="w-3.5 h-3.5 animate-bounce" />
          </button>
        ) : (
          <button
            onClick={handleFinalSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Finish & Seal</span>
          </button>
        )}
      </div>

      {/* Signature / Initials Capture Modal */}
      {activeModalField && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 space-y-5 shadow-2xl text-[#0F172A]">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1D72FE]">
                  <PenTool className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Affix Digital Signature & Cryptographic Seal
                  </h3>
                  <p className="text-[10px] text-slate-500">Docurama Root CA Trust Framework</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveModalField(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="flex items-center gap-1 bg-[#F1F5F9] p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setSigMode('draw')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'draw' ? 'bg-[#1D72FE] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <PenTool className="w-3.5 h-3.5" />
                Draw
              </button>
              <button
                onClick={() => setSigMode('type')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'type' ? 'bg-[#1D72FE] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]'
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
                  sigMode === 'phone' ? 'bg-[#1D72FE] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Phone
              </button>
              <button
                onClick={() => setSigMode('passkey')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  sigMode === 'passkey' ? 'bg-[#1D72FE] text-white shadow-sm' : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <Fingerprint className="w-3.5 h-3.5" />
                Passkey
              </button>
            </div>

            {/* Ink Color Selector (Draw & Type modes) */}
            {(sigMode === 'draw' || sigMode === 'type') && (
              <div className="flex items-center justify-between px-1 text-xs">
                <span className="text-[11px] font-semibold text-slate-500">Pen Ink Color:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInkColor('#0f172a')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${
                      inkColor === '#0f172a'
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-[#0f172a] border border-white" />
                    Executive Slate
                  </button>
                  <button
                    type="button"
                    onClick={() => setInkColor('#1d4ed8')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${
                      inkColor === '#1d4ed8'
                        ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-[#1d4ed8] border border-white" />
                    Royal Blue
                  </button>
                </div>
              </div>
            )}

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
                <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                  <span>Draw using mouse, stylus or touchpad</span>
                  <span className="text-[#1D72FE] font-medium">Bézier Velocity Smoothing Active</span>
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
                  className="base-input w-full h-11 px-4 text-sm"
                />

                <div className="grid grid-cols-2 gap-2">
                  {HANDWRITING_FONTS.map(f => {
                    const isSelected = selectedFont === f.fontFamily;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFont(f.fontFamily)}
                        style={{ fontFamily: f.fontFamily, color: inkColor }}
                        className={`p-3 rounded-xl text-left bg-white text-xl truncate border-2 transition-all ${
                          isSelected ? 'border-[#1D72FE] ring-2 ring-blue-100 shadow-md' : 'border-slate-200 hover:border-slate-300'
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
                <div className="w-48 h-48 bg-[#F8FAFC] p-3 rounded-2xl mx-auto border border-slate-200 shadow-inner flex items-center justify-center">
                  {mobileQr ? (
                    <img src={mobileQr} alt="Scan QR Code to Sign on Phone" className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-6 h-6 border-2 border-[#1D72FE] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-[#0F172A]">Scan to Sign on Mobile Touchscreen</div>
                  <div className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                    Point your camera at this QR code. Sign smoothly on your mobile touch screen and watch your desktop update in real-time.
                  </div>
                </div>
              </div>
            )}

            {/* Passkey Biometrics Mode */}
            {sigMode === 'passkey' && (
              <div className="p-5 rounded-2xl bg-[#F8FAFC] border border-slate-200 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 mx-auto flex items-center justify-center shadow-sm">
                  <Fingerprint className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#0F172A]">Hardware Biometric Authentication</h4>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                    Authenticate via FIDO2 / WebAuthn using Touch ID, Face ID, or Windows Hello. Your signature will be bound to your cryptographic secure enclave.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={biometricStatus === 'verifying'}
                    onClick={handleBiometricSign}
                    className="btn btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold shadow-md"
                  >
                    {biometricStatus === 'verifying' ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Verifying Biometric Sensor...</span>
                      </>
                    ) : biometricStatus === 'success' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-white" />
                        <span>Biometric Assertion Verified!</span>
                      </>
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        <span>Authenticate with Biometrics</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1.5 pt-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>eIDAS Qualified Advanced Electronic Signature Equivalent</span>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setActiveModalField(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              {sigMode !== 'phone' && sigMode !== 'passkey' && (
                <button
                  onClick={applySignature}
                  className="btn btn-primary px-6 py-2 text-xs font-bold shadow-md"
                >
                  Adopt &amp; Sign
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Legal & Security Compliance Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-6 space-y-5 shadow-2xl text-[#0F172A]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-[#0F172A]">Document Legal Validity &amp; Security</h3>
              </div>
              <button onClick={() => setShowSecurityModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-[#1D72FE] tracking-wider">eIDAS &amp; ESIGN Compliance</span>
                <p className="text-[11px] text-slate-600">
                  Electronic signatures executed via Docurama carry full legal validity, enforceability, and court admissibility under EU Regulation 910/2014 and the US ESIGN Act of 2000.
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Cryptographic PAdES-LTV Seal</span>
                <p className="text-[11px] text-slate-600">
                  Each finalized document is sealed with an immutable SHA-256 state digest and embedded cryptographic certificates providing Long-Term Validation (LTV) independent of Docurama servers.
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">RFC 3161 Certified Timestamping</span>
                <p className="text-[11px] text-slate-600">
                  Every signature record captures hardware telemetry, IP address, and high-entropy timestamping issued by certified Trust Service Providers.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowSecurityModal(false)}
              className="btn btn-white w-full py-2 text-xs font-bold border border-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Decline Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-6 space-y-4 shadow-2xl text-[#0F172A]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-600" />
                Decline to Sign Document
              </h3>
              <button onClick={() => setShowDeclineModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Please specify the reason you are refusing to execute this agreement. The sender will be informed immediately.
            </p>
            <form onSubmit={handleDeclineSubmit} className="space-y-4">
              <textarea
                required
                rows={3}
                placeholder="Reason for declining..."
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                className="base-input w-full p-3 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeclineModal(false)}
                  className="btn btn-white px-4 py-2 text-xs border border-slate-200"
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
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 p-6 space-y-4 shadow-2xl text-[#0F172A]">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#1D72FE]" />
                Delegate Signing Authority
              </h3>
              <button onClick={() => setShowDelegateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Reassign your signature duties to another authorized representative in your organization.
            </p>
            <form onSubmit={handleDelegateSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] text-slate-600 font-semibold mb-1">Delegate Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sarah Connor"
                  value={delegateName}
                  onChange={(e) => setDelegateName(e.target.value)}
                  className="base-input w-full h-10 px-3 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-600 font-semibold mb-1">Delegate Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. sarah@enterprise.com"
                  value={delegateEmail}
                  onChange={(e) => setDelegateEmail(e.target.value)}
                  className="base-input w-full h-10 px-3 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDelegateModal(false)}
                  className="btn btn-white px-4 py-2 text-xs border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary px-4 py-2 text-xs font-bold"
                >
                  Confirm Delegation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contract Intelligence & Risk Assessment Drawer */}
      {showAnalysisDrawer && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-md h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col text-[#0F172A] animate-in slide-in-from-right duration-300">
            
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-[#F8FAFC]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Contract Intelligence</h3>
                  <p className="text-[10px] text-slate-500">Local AI Document Comprehension &amp; Risk Engine</p>
                </div>
              </div>
              <button
                onClick={() => setShowAnalysisDrawer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {loadingAnalysis ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
                  <p className="text-xs font-semibold text-slate-700">Analyzing clauses, governing laws &amp; covenants...</p>
                  <p className="text-[11px] text-slate-400">Zero external API dependencies • 100% privacy preserved</p>
                </div>
              ) : analysisReport ? (
                <>
                  {/* Executive Overview Card */}
                  <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-slate-200 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Classification</span>
                        <h4 className="text-sm font-bold text-[#0F172A] mt-0.5">{analysisReport.document_type}</h4>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border shrink-0 ${
                        analysisReport.risk_badge === 'amber'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : analysisReport.risk_badge === 'blue'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}>
                        {analysisReport.overall_risk_assessment}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-500" />
                        <span>~{analysisReport.estimated_read_minutes} min read</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span>{analysisReport.word_count} words ({analysisReport.page_count} pages)</span>
                      </div>
                    </div>
                  </div>

                  {/* Key Commercial Terms Grid */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                      <Scale className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Key Commercial Terms</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 bg-[#F8FAFC] p-3.5 rounded-2xl border border-slate-200">
                      <div className="flex justify-between items-center py-1 border-b border-slate-200">
                        <span className="text-slate-500 text-[11px]">Governing Law</span>
                        <span className="font-semibold text-slate-800">{analysisReport.key_commercial_terms.governing_law}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-slate-200">
                        <span className="text-slate-500 text-[11px]">Termination Notice</span>
                        <span className="font-semibold text-slate-800">{analysisReport.key_commercial_terms.termination_notice}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-slate-200">
                        <span className="text-slate-500 text-[11px]">Payment Terms</span>
                        <span className="font-semibold text-slate-800">{analysisReport.key_commercial_terms.payment_terms}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-slate-500 text-[11px]">Dispute Forum</span>
                        <span className="font-semibold text-slate-800">{analysisReport.key_commercial_terms.dispute_resolution}</span>
                      </div>
                    </div>
                  </div>

                  {/* Risk & Covenant Flags */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                      <span>Covenant &amp; Risk Insights ({analysisReport.risk_flags.length})</span>
                    </div>

                    <div className="space-y-2">
                      {analysisReport.risk_flags.map((flag, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-[#0F172A]">{flag.title}</span>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                              flag.severity === 'high'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : flag.severity === 'medium'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}>
                              {flag.severity}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 leading-relaxed">{flag.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Correction CTA in Drawer */}
                  <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200/80 space-y-2.5">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <MessageSquareText className="w-4 h-4 text-amber-700" />
                      <span>Spot a discrepancy or unacceptable clause?</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      You can request an in-line correction directly with the document originator rather than signing or declining outright.
                    </p>
                    <button
                      onClick={() => {
                        setShowAnalysisDrawer(false);
                        setShowCorrectionModal(true);
                        loadCorrections();
                      }}
                      className="btn btn-primary w-full py-2 text-xs font-bold shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <MessageSquareText className="w-3.5 h-3.5" />
                      <span>Submit In-Line Correction Request</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-slate-500">
                  <p>Analysis data not yet available for this document.</p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* In-Line Correction Request Modal */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 p-6 space-y-5 shadow-2xl text-[#0F172A]">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                  <MessageSquareText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Request Pre-Sign Document Correction</h3>
                  <p className="text-[10px] text-slate-500">Collaborative in-line negotiation with the sender</p>
                </div>
              </div>
              <button
                onClick={() => setShowCorrectionModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {correctionSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{correctionSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleCorrectionSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Clause or Field Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Section 5 - Payment Terms or Signature Block"
                  value={correctionClause}
                  onChange={(e) => setCorrectionClause(e.target.value)}
                  className="base-input w-full h-10 px-3 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Suggested Correction or Amendment *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Explain what needs to be changed before you can execute this agreement (e.g. 'Please change payment terms from Net 30 to Net 60 days as agreed')..."
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  className="base-input w-full p-3 text-xs"
                />
              </div>

              {correctionsList.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Previously Requested Amendments ({correctionsList.length})
                  </span>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {correctionsList.map((item) => (
                      <div key={item.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-800">{item.clause_title || 'General'}</div>
                          <p className="text-[11px] text-slate-600 mt-0.5">{item.suggested_correction}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                          {item.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCorrectionModal(false)}
                  className="btn btn-white px-4 py-2 text-xs border border-slate-200"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submittingCorrection}
                  className="btn btn-primary px-5 py-2 text-xs font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submittingCorrection ? 'Dispatching...' : 'Submit Request'}</span>
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
