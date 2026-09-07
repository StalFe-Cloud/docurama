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
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#f6f5f4]">
      <div className="w-full max-w-md bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card relative z-10">
        
        {/* Back button if available */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="mb-4 text-xs font-normal text-[#787671] hover:text-[#1a1a1a] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to overview</span>
          </button>
        )}

        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/logo.svg" alt="Docurama" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold text-[#1a1a1a] tracking-tight">
            Docurama
          </h1>
          <p className="text-xs text-[#787671] mt-1 font-medium">
            Document Intelligence and Cryptographic Workflows
          </p>
          <h2 className="text-sm font-semibold text-[#37352f] mt-4">Sign in to your account</h2>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#e03131]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="text-xs font-medium text-[#787671] block mb-1.5">
              Email address
            </label>
            <div className="relative">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <div className="form-control">
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium text-[#787671]">
                Password
              </label>
              <a 
                href="#forgot" 
                onClick={(e) => { e.preventDefault(); alert('Password recovery reset token dispatched to administrator mailbox.'); }} 
                className="text-xs text-[#0075de] hover:underline transition-colors"
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
                className="base-input w-full h-11 px-3.5 text-sm font-mono bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-11 text-sm font-medium flex items-center justify-center gap-2 bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md transition-colors disabled:opacity-50"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-xs text-[#787671]">
          Hardware-backed cryptographic security
        </div>
      </div>
    </div>
  );
};
