import React, { useState } from 'react';
import { ArrowRight, AlertCircle, ArrowLeft, ShieldCheck, Mail } from 'lucide-react';
import { api } from '../lib/api';

interface SignInPageProps {
  onSuccess: (user: any) => void;
  onCancel?: () => void;
}

type Step = 'password' | 'code' | 'forgot' | 'forgot_sent';

export const SignInPage: React.FC<SignInPageProps> = ({ onSuccess, onCancel }) => {
  // Empty, always. Anything seeded here is compiled into the public JavaScript bundle
  // and served to every visitor, which is how a working administrator password came to
  // be readable at the sign-in page.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const res = await api.login(email, password);
      // With two-factor enrolled, a correct password returns a challenge and no
      // session. Passing that on as a user would sign nobody in and strand the
      // visitor, which is what happened before this step existed.
      if (res && res.mfa_required) {
        setChallenge(res.challenge_token);
        setCode('');
        setStep('code');
        return;
      }
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const res = await api.verifyTotpLogin(challenge, code.trim());
      onSuccess(res.user);
    } catch (err: any) {
      const message = err.message || 'That code is not valid.';
      // The challenge lasts five minutes. Once it lapses, only a fresh password
      // attempt can issue another, so send the visitor back rather than letting them
      // retype codes against a dead challenge.
      if (/expired/i.test(message)) {
        setStep('password');
        setPassword('');
        setChallenge('');
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const res = await api.requestPasswordReset(email.trim());
      // Show the server's own wording. It is deliberately the same whether or not the
      // address has an account, and this screen must not claim more than that.
      setNotice(res.message);
      setStep('forgot_sent');
    } catch (err: any) {
      setError(err.message || 'Could not request a reset. Try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  const backToPassword = () => {
    setError('');
    setNotice('');
    setStep('password');
  };

  const heading =
    step === 'code' ? 'Two-factor authentication'
    : step === 'forgot' || step === 'forgot_sent' ? 'Reset your password'
    : 'Sign in to your organization';

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#f6f5f4]">
      <div className="w-full max-w-md bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card relative z-10">

        {onCancel && step === 'password' && (
          <button
            onClick={onCancel}
            className="mb-4 text-xs font-normal text-[#787671] hover:text-[#1a1a1a] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to overview</span>
          </button>
        )}
        {step !== 'password' && (
          <button
            onClick={backToPassword}
            className="mb-4 text-xs font-normal text-[#787671] hover:text-[#1a1a1a] flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to sign in</span>
          </button>
        )}

        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center mb-2">
            <img src="/logo_horizontal.png" alt="Docurama: Documents Signed Simplified" className="h-11 object-contain" />
          </div>
          <p className="text-xs text-[#5d5b54] mt-1 font-medium">
            Electronic Signatures &amp; Document Intelligence
          </p>
          <h2 className="text-sm font-semibold text-[#1a1a1a] mt-4">{heading}</h2>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#e03131]" />
            <span>{error}</span>
          </div>
        )}

        {step === 'password' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="form-control">
              <label className="text-xs font-medium text-[#787671] block mb-1.5">Email address</label>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="name@company.com"
              />
            </div>

            <div className="form-control">
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-[#787671]">Password</label>
                <button
                  type="button"
                  onClick={() => { setError(''); setStep('forgot'); }}
                  className="text-xs text-[#0075de] hover:underline transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm font-mono bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="••••••••"
              />
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

            <div className="pt-1 text-center text-xs text-[#787671]">
              Need an account?{' '}
              <a href="/sign_up" className="text-[#0075de] hover:underline transition-colors">
                Sign up
              </a>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleCode} className="space-y-4">
            <div className="flex items-start gap-2 text-xs text-[#5d5b54]">
              <ShieldCheck className="w-4 h-4 shrink-0 text-[#1aae39] mt-0.5" />
              <span>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</span>
            </div>
            <input
              type="text"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="base-input w-full h-11 px-3.5 text-center text-lg tracking-[0.3em] font-mono bg-white border border-[#c8c4be] rounded-md"
              placeholder="000000"
            />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="btn btn-primary w-full h-11 text-sm font-medium bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-xs text-[#5d5b54]">
              Enter the email address for your account and we will send a link to choose a new password.
            </p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="base-input w-full h-11 px-3.5 text-sm bg-white border border-[#c8c4be] rounded-md"
              placeholder="name@company.com"
            />
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-11 text-sm font-medium bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}

        {step === 'forgot_sent' && (
          <div className="p-3 rounded-md bg-[#dcecfa]/60 border border-[#0075de]/20 text-[#1a1a1a] text-xs flex items-start gap-2">
            <Mail className="w-4 h-4 shrink-0 text-[#0075de] mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        <div className="mt-6 text-center text-xs text-[#787671]">
          Hardware-backed cryptographic security
        </div>
      </div>
    </div>
  );
};
