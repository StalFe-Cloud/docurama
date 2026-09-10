import React, { useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';

interface ResetPasswordPageProps {
  onDone: () => void;
}

// Mirrors the server rule in services/password_reset.py, so the common mistake is
// caught before a round trip. The server remains the authority.
const MIN_PASSWORD_LENGTH = 12;

/**
 * Landing page for the link in a password reset email.
 *
 * The reset email has always pointed at /reset-password?token=..., but no route
 * handled that path, so the link fell through to the landing page and the reset could
 * never be completed.
 */
export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ onDone }) => {
  const token = new URLSearchParams(window.location.search).get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      await api.resetPassword(token, password);
      setDone(true);
      // Strip the token from the address bar so it does not linger in history.
      window.history.replaceState({}, '', '/reset-password');
    } catch (err: any) {
      setError(err.message || 'This reset link is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center px-4 py-12 bg-[#f6f5f4]">
      <div className="w-full max-w-md bg-white rounded-lg p-8 md:p-10 border border-[#e5e3df] shadow-notion-card">
        <div className="text-center mb-7">
          <img src="/logo_horizontal.png" alt="Docurama" className="h-11 object-contain inline-block mb-2" />
          <h2 className="text-sm font-semibold text-[#1a1a1a] mt-4">Choose a new password</h2>
        </div>

        {!token && !done && (
          <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>This link is missing its reset token. Request a new one from the sign-in page.</span>
          </div>
        )}

        {done ? (
          <div className="space-y-5">
            <div className="p-3 rounded-md bg-[#d9f3e1]/60 border border-[#1aae39]/30 text-[#1a1a1a] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1aae39]" />
              <span>Your password has been reset. Sign in with your new password.</span>
            </div>
            <button
              onClick={onDone}
              className="btn btn-primary w-full h-11 text-sm font-medium flex items-center justify-center gap-2 bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md"
            >
              <span>Go to sign in</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : token ? (
          <>
            {error && (
              <div className="p-3 rounded-md bg-[#fde0ec] border border-[#ff64c8]/30 text-[#e03131] text-xs flex items-center gap-2 mb-5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[#787671] block mb-1.5">New password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="base-input w-full h-11 px-3.5 text-sm font-mono bg-white border border-[#c8c4be] rounded-md"
                />
                <p className="text-[11px] text-[#787671] mt-1">At least {MIN_PASSWORD_LENGTH} characters.</p>
              </div>
              <div>
                <label className="text-xs font-medium text-[#787671] block mb-1.5">Confirm new password</label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="base-input w-full h-11 px-3.5 text-sm font-mono bg-white border border-[#c8c4be] rounded-md"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full h-11 text-sm font-medium bg-[#5645d4] hover:bg-[#4534b3] text-white rounded-md disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Reset password'}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
};
