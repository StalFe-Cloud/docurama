import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Lightweight toast system (shadcn pattern, zero extra dependency).
 *
 * Replaces window.alert() - inline, non-blocking feedback that respects the
 * visual language. Transient notices only; forms keep their inline errors.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export const useToast = () => useContext(ToastContext);

const AUTO_DISMISS_MS = 4200;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 w-[calc(100vw-3rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const kindIcon: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-[#1a7f37] shrink-0" />,
  error: <AlertCircle className="size-4 text-[#c92a2a] shrink-0" />,
  info: <Info className="size-4 text-[#0075de] shrink-0" />,
};

const ToastRow: React.FC<{ item: ToastItem; onDismiss: (id: number) => void }> = ({
  item,
  onDismiss,
}) => {
  useEffect(() => {
    // Timers are per-row so early dismissal cancels nothing globally.
    return undefined;
  }, []);

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white p-3.5 pr-2.5 shadow-[0px_16px_48px_-8px_rgba(15,15,15,0.16)]',
        'animate-in fade-in slide-in-from-bottom-2 duration-200',
        item.kind === 'success' && 'border-[#b8e6c6]',
        item.kind === 'error' && 'border-[#ffc9c9]',
        item.kind === 'info' && 'border-[#c2ddf5]'
      )}
    >
      {kindIcon[item.kind]}
      <span className="text-xs leading-5 text-[#1a1a1a] font-medium flex-1">{item.message}</span>
      <button
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="rounded-md p-1 text-[#a4a097] hover:text-[#1a1a1a] hover:bg-[#f6f5f4] transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};
