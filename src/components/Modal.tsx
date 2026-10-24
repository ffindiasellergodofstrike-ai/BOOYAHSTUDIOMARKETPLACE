import React, { useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '6xl';
  mobileFullscreen?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
  mobileFullscreen = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const first = modalRef.current?.querySelector<HTMLElement>('[autofocus], input, button, a[href], [tabindex="0"]');
      if (!modalRef.current?.contains(document.activeElement)) first?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '6xl': 'max-w-6xl',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          id="modal-overlay"
          className={`fixed inset-0 z-50 flex items-center justify-center overflow-y-auto ${
            mobileFullscreen ? 'p-0 sm:p-6' : 'p-4 sm:p-6'
          }`}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
            aria-hidden="true"
          />

          {/* Dialog Container */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : "Dialog"}
            className={`relative w-full ${maxWidthClasses[maxWidth]} bg-white shadow-2xl border border-slate-200 z-10 overflow-hidden my-auto flex flex-col ${
              mobileFullscreen
                ? 'h-[100dvh] rounded-none max-h-[100dvh] sm:h-auto sm:rounded-2xl sm:max-h-[calc(100dvh-3rem)]'
                : 'rounded-2xl max-h-[calc(100dvh-2rem)]'
            }`}
          >
            {/* Header */}
            {title && (
              <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:flex sm:justify-between sm:gap-4 items-center border-b border-slate-100 bg-slate-50/50 shrink-0 ${
                mobileFullscreen ? 'px-4 py-3 sm:px-6 sm:py-4' : 'px-6 py-4'
              }`}>
                <div className="min-w-0">
                  <h3 id={titleId} className="text-base sm:text-lg font-semibold text-slate-900 leading-snug break-words">{title}</h3>
                </div>
                <button
                  id="modal-close-btn"
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px]"
                  aria-label="Close dialog"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Content */}
            <div className={`overflow-y-auto flex-1 ${mobileFullscreen ? 'p-3 sm:p-6' : 'p-6'}`}>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
