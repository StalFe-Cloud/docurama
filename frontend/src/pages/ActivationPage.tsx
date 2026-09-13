import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Domain-join account activation (§18).
 *
 * The landing page for the single-use link in the activation email. The token
 * is consumed by the backend, which enforces purpose and single-use semantics;
 * this page only carries it and reports the outcome honestly - including the
 * approval-pending state, which is a success of the flow, not an error.
 */
export const ActivationPage: React.FC = () => {
  const [state, setState] = useState<'working' | 'activated' | 'pending_approval' | 'failed'>('working');
  const [message, setMessage] = useState('Activating your account…');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setState('failed');
      setMessage('This activation link is missing its token. Ask your administrator for a fresh invitation email.');
      return;
    }
    (async () => {
      try {
        const result = await api.activateDomainJoin(token);
        if (result?.membership === 'pending_approval') {
          setState('pending_approval');
          setMessage('Your email is confirmed. A workspace administrator still needs to approve your access - we will notify you once you are in.');
        } else {
          setState('activated');
          setMessage('Your account is active. You can sign in now.');
        }
      } catch (e: any) {
        setState('failed');
        setMessage(e?.message || 'Activation failed. The link may already have been used or has expired.');
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#f6f5f4] text-[#37352f] flex items-center justify-center px-4">
      <div className="bg-white rounded-lg border border-[#E2E8F0] shadow-sm max-w-md w-full p-8 text-center">
        <h1 className="text-lg font-semibold mb-3">Account activation</h1>
        <p className="text-sm text-[#64748B] mb-6">{message}</p>
        {state !== 'working' && (
          <a
            href="/sign_in"
            className="inline-block px-4 py-2 rounded-md bg-[#37352f] text-white text-sm hover:bg-black transition-colors"
          >
            Go to sign in
          </a>
        )}
      </div>
    </div>
  );
};
