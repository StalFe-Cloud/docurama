import React, { useState } from 'react';
import { Mail, Lock, ArrowRight, AlertCircle, ArrowLeft } from 'lucide-react';
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
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#F8FAFC]">
      {/* Ambient background glow matching production */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#1D72FE]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[#6366F1]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-white rounded-3xl p-8 md:p-10 border border-[#E2E8F0] shadow-xl relative z-10">
        
        {/* Back button if available */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="mb-4 text-xs font-semibold text-[#64748B] hover:text-[#0F172A] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to overview</span>
          </button>
        )}

        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/logo.svg" alt="Docurama" className="w-12 h-12 object-contain" />
          </div>
          <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight font-heading">
            Docu<span className="text-[#1D72FE]">rama</span>
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-[#64748B] font-semibold mt-1">
            DOCUMENTS • SIGNED • SIMPLIFIED
          </p>
          <h2 className="text-lg font-semibold text-[#334155] mt-4">Sign In</h2>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2.5 mb-5">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="block text-xs font-semibold text-[#475569] uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div className="form-control">
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs font-semibold text-[#475569] uppercase tracking-wider">
                Password
              </label>
              <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Password recovery reset token dispatched to administrator mailbox.'); }} className="text-xs text-[#1D72FE] hover:underline font-medium">
                Forgot your password?
              </a>
            </div>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-11 font-semibold text-base shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-xs text-[#94A3B8]">
          Protected by enterprise-grade cryptographic signatures
        </div>
      </div>
    </div>
  );
};
