import React, { useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

// Account creation. On success the registration response has already set the
// session cookie, so a fresh load of /onboarding arrives signed in. Every failure
// path shows the server's own wording; a closed deployment must read as closed,
// never as a transient glitch.
export const SignUpPage: React.FC = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Sprint 3 registration hardening: the age statement is recorded, not
  // verified; marketing consent is a genuine opt-in that is timestamped
  // server-side and never pre-ticked.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      await api.register({
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        age_gate_confirmed: ageConfirmed,
        marketing_consent: marketingConsent,
      } as any);
      window.location.href = '/onboarding';
    } catch (err: any) {
      setError(err.message || 'Could not create the account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 relative overflow-hidden bg-[#f6f5f4]">
      <div className="w-full max-w-md bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card relative z-10">

        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center mb-2">
            <img src="/logo_horizontal.png" alt="Docurama: Documents Signed Simplified" className="h-11 object-contain" />
          </div>
          <p className="text-xs text-[#5d5b54] mt-1 font-medium">
            Electronic Signatures &amp; Document Intelligence
          </p>
          <h2 className="text-sm font-semibold text-[#1a1a1a] mt-4">Create your account</h2>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#e03131]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="text-xs font-medium text-[#787671] block mb-1.5">First name</label>
              <input
                type="text"
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="Ada"
              />
            </div>

            <div className="form-control">
              <label className="text-xs font-medium text-[#787671] block mb-1.5">Last name (optional)</label>
              <input
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="base-input w-full h-11 px-3.5 text-sm bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
                placeholder="Lovelace"
              />
            </div>
          </div>

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
            <label className="text-xs font-medium text-[#787671] block mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="base-input w-full h-11 px-3.5 text-sm font-mono bg-white border border-[#c8c4be] rounded-md text-[#1a1a1a] focus:border-[#5645d4] focus:ring-1 focus:ring-[#5645d4]"
              placeholder="••••••••"
            />
            <p className="text-xs text-[#787671] mt-1.5">At least 12 characters.</p>
          </div>

          <div className="pt-2 space-y-2 text-xs text-[#787671]">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                required
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                className="mt-0.5 accent-[#5645d4]"
              />
              <span>I confirm I am of legal age to form a binding contract in my jurisdiction.</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 accent-[#5645d4]"
              />
              <span>Send me occasional product updates by email (optional; unsubscribe anytime).</span>
            </label>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full h-11 text-sm font-medium flex items-center justify-center gap-2 bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md transition-colors disabled:opacity-50"
            >
              <span>{loading ? 'Creating account...' : 'Create Account'}</span>
              <ArrowRight className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </form>

        <div className="mt-4 text-center text-xs text-[#787671]">
          Already have an account?{' '}
          <a href="/sign_in" className="text-[#0075de] hover:underline transition-colors">
            Sign in
          </a>
        </div>

        <div className="mt-6 text-center text-xs text-[#787671]">
          Hardware-backed cryptographic security
        </div>
      </div>
    </div>
  );
};
