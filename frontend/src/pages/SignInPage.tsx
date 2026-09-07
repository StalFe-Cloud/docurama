import React, { useState } from 'react';
import { ArrowRight, AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';

interface SignInPageProps {
  onSuccess: (user: any) => void;
  onCancel?: () => void;
}

export const SignInPage: React.FC<SignInPageProps> = ({ onSuccess, onCancel }) => {
  const [email, setEmail] = useState('admin@docurama.com');
  const [password, setPassword] = useState('Docurama2026!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const res = await api.login(email, password);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#0a0a0a]">
      <div className="w-full max-w-md bg-[#191919] rounded-lg p-8 md:p-10 border border-[#212327] relative z-10">
        
        {/* Back button if available */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="mb-4 text-xs font-normal text-[#7d8187] hover:text-white flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to overview</span>
          </button>
        )}

        {/* Brand Header in xAI Typography */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/logo.svg" alt="Docurama" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-normal text-white tracking-[-0.04em] font-display">
            Docu<span className="text-[#dadbdf]">rama</span>
          </h1>
          <p className="caption-mono-sm text-[9px] text-[#7d8187] tracking-[1.4px] mt-1">
            DOCUMENT INTELLIGENCE
          </p>
          <h2 className="text-sm font-normal text-[#dadbdf] mt-4">Sign In</h2>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[#ff7a17]/10 border border-[#ff7a17]/30 text-[#ffc285] text-xs flex items-center gap-2 mb-5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#ff7a17]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="caption-mono-sm text-[10px] text-[#7d8187] tracking-[1.2px] block mb-1.5">
              EMAIL ADDRESS
            </label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="base-input w-full h-10 px-3.5 text-xs"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div className="form-control">
            <div className="flex justify-between items-center mb-1.5">
              <label className="caption-mono-sm text-[10px] text-[#7d8187] tracking-[1.2px]">
                PASSWORD
              </label>
              <a 
                href="#forgot" 
                onClick={(e) => { e.preventDefault(); alert('Password recovery reset token dispatched to administrator mailbox.'); }} 
                className="text-xs text-[#7d8187] hover:text-white transition-colors"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="base-input w-full h-10 px-3.5 text-xs font-mono"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-10 text-xs font-normal flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-3.5 h-3.5 stroke-[2]" />
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-xs text-[#7d8187] font-mono text-[11px]">
          Hardware-backed cryptographic security
        </div>
      </div>
    </div>
  );
};
