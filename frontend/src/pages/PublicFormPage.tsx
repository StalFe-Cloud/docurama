import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Send, 
  ShieldCheck, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { api } from '../lib/api';

interface PublicFormPageProps {
  slug: string;
}

export const PublicFormPage: React.FC<PublicFormPageProps> = ({ slug }) => {
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTemplate();
  }, [slug]);

  const loadTemplate = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.getPublicTemplate(slug);
      setTemplate(data);
    } catch (err: any) {
      setError(err.message || 'Public document form not found or has been disabled.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartSigning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Please provide your full legal name and email address.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      const res = await api.startPublicTemplate(slug, name.trim(), email.trim());
      // Redirect to signing URL
      if (res.signing_token) {
        window.location.href = `/s/${res.signing_token}`;
      } else {
        throw new Error('No signing session token returned.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initiate signing session.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Loading document template...</p>
        </div>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl glass-card border border-rose-500/20 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Document Unavailable</h2>
        <p className="text-xs text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-12 px-4 sm:px-6 space-y-8">
      {/* Brand Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-400/20 text-xs font-semibold text-indigo-300">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          Self-Service Document Portal
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          {template?.title || 'Public Document'}
        </h1>
        {template?.description && (
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {template.description}
          </p>
        )}
      </div>

      {/* Main Intake Form Card */}
      <div className="p-8 rounded-3xl glass-card border border-white/10 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
            <FileText className="w-4 h-4 text-indigo-400" />
            <span>Digital Document Intake</span>
          </div>
          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/5">
            PAdES-LTV Compliant
          </span>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleStartSigning} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Full Legal Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Eleanor Vance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Email Address *
            </label>
            <input
              type="email"
              required
              placeholder="e.g. eleanor@enterprise.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              A cryptographically sealed copy of the executed document will be sent to this email upon completion.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl text-sm font-bold text-white btn-primary-glow disabled:opacity-50 transition-all shadow-lg"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Preparing Document...</span>
                </>
              ) : (
                <>
                  <span>Proceed to Digital Signing</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security badges */}
        <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>256-Bit Hardware Trust</span>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>RFC 3161 Timestamped</span>
          </div>
        </div>
      </div>
    </div>
  );
};
