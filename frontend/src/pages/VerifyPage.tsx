import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Search, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  FileText, 
  ExternalLink,
  Shield,
  KeyRound,
  Globe
} from 'lucide-react';
import { api, VerificationResult } from '../lib/api';

export const VerifyPage: React.FC = () => {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check URL query param ?code=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get('code');
    if (c) {
      setCode(c);
      verifyCode(c);
    }
  }, []);

  const verifyCode = async (searchCode: string) => {
    if (!searchCode.trim()) return;
    try {
      setLoading(true);
      setError('');
      const res = await api.verifyByCode(searchCode.trim());
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Verification lookup failed. Code not found.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        setLoading(true);
        setError('');
        const res = await api.verifyByUpload(file);
        setResult(res);
      } catch (err: any) {
        setError(err.message || 'Document verification failed.');
        setResult(null);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-20">
      
      {/* Top Banner */}
      <div className="text-center space-y-3 pt-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200/60 text-xs font-semibold text-emerald-700">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Docurama Document Trust &amp; Attestation Authority
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0F172A] font-heading">
          Public Verification Portal
        </h1>
        <p className="text-xs sm:text-sm text-[#64748B] max-w-xl mx-auto leading-relaxed">
          Verify PAdES-LTV electronic signatures, DigiCert RFC 3161 cryptographic timestamps, and SHA-256 document tamper integrity against the Docurama Root CA registry.
        </p>
      </div>

      {/* Verification Inputs Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-[#E2E8F0] shadow-sm space-y-5">
        
        {/* Code Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Enter Verification Code or Envelope ID (e.g. 7A8B9C...)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && verifyCode(code)}
              className="base-input w-full pl-10 pr-4 h-11 text-xs uppercase font-mono"
            />
          </div>
          <button
            onClick={() => verifyCode(code)}
            disabled={loading}
            className="btn btn-primary px-6 h-11 text-xs font-bold disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </div>

        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-slate-200" />
          <span className="flex-shrink mx-4 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
            or upload document
          </span>
          <div className="flex-grow border-t border-slate-200" />
        </div>

        {/* Upload Box */}
        <label className="border-2 border-dashed border-[#CBD5E1] hover:border-[#1D72FE] rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[#F8FAFC]">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Upload className="w-8 h-8 text-[#1D72FE] mb-2" />
          <span className="text-xs font-semibold text-[#0F172A]">Click to drop signed PDF document for instant cryptographic analysis</span>
          <span className="text-[10px] text-slate-500 mt-1">Calculates SHA-256 and validates embedded signature certificates</span>
        </label>

      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Verification Result Card */}
      {result && (
        <div className="rounded-3xl bg-white border border-[#E2E8F0] shadow-md overflow-hidden space-y-6 animate-in fade-in-50 duration-300">
          
          {/* Header Badge */}
          <div className={`p-6 border-b flex items-start justify-between ${
            result.is_valid 
              ? 'bg-emerald-50/50 border-emerald-100' 
              : 'bg-rose-50/50 border-rose-100'
          }`}>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                result.is_valid ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
              }`}>
                {result.is_valid ? <CheckCircle2 className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  {result.is_valid ? 'Cryptographically Sealed & Verified' : 'Verification Issue Detected'}
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">{result.message}</p>
              </div>
            </div>

            <span className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              PAdES-LTV
            </span>
          </div>

          <div className="p-6 space-y-6 pt-0 text-xs">
            
            {/* Metadata Table */}
            <div className="space-y-3 bg-[#F8FAFC] p-5 rounded-2xl border border-slate-200/80">
              {result.envelope_title && (
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Document Subject</span>
                  <span className="font-semibold text-[#0F172A]">{result.envelope_title}</span>
                </div>
              )}
              {result.verification_code && (
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Verification Code</span>
                  <span className="font-mono font-bold text-[#1D72FE]">{result.verification_code}</span>
                </div>
              )}
              {result.issuer_domain_verified && result.verified_domain && (
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#1D72FE]" />
                    Corporate Domain Identity
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold font-mono">
                    <CheckCircle2 className="w-3 h-3" />
                    DNS Verified ({result.verified_domain})
                  </span>
                </div>
              )}
              {result.completed_at && (
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Sealed Timestamp</span>
                  <span className="font-mono text-slate-700">{new Date(result.completed_at).toUTCString()}</span>
                </div>
              )}
              {result.sha256 && (
                <div className="flex flex-col gap-1 pb-2 border-b border-slate-200">
                  <span className="text-slate-500 text-[10px]">Document Checksum (SHA-256):</span>
                  <span className="font-mono text-[10px] text-emerald-800 bg-white p-2 rounded border border-slate-200 break-all">
                    {result.sha256}
                  </span>
                </div>
              )}
              {result.certificate_subject && (
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500">Signer Certificate</span>
                  <span className="font-medium text-slate-800 text-right">{result.certificate_subject}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Root Authority</span>
                <span className="font-semibold text-emerald-700">Docurama Root Certification Authority (FR)</span>
              </div>
            </div>

            {/* Audit Trail Events */}
            {result.audit_trail && result.audit_trail.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Provenance &amp; Audit Events
                </h3>
                <div className="space-y-2">
                  {result.audit_trail.map((a, idx) => (
                    <div key={idx} className="p-3.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-[#0F172A]">{a.description}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{a.actor_name}</div>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 text-right">
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
};
