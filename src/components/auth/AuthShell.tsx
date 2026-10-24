import React from 'react';
import { ArrowLeft, ArrowUpRight, Check, Download, Layers3, Sparkles } from 'lucide-react';
import '../../styles/auth.css';

type Props = {
  title: string;
  description: string;
  eyebrow: string;
  mode?: 'login' | 'register' | 'recovery';
  children: React.ReactNode;
  footer?: React.ReactNode;
  onBack: () => void;
};

export function AuthShell({ title, description, eyebrow, mode = 'login', children, footer, onBack }: Props) {
  const story = mode === 'register'
    ? <>A little inspiration.<br /><em>A new beginning.</em></>
    : mode === 'recovery'
      ? <>Back to your ideas.<br /><em>Back to creating.</em></>
      : <>Your next idea<br />is <em>waiting for you.</em></>;
  return <section className={`auth-page auth-page-${mode}`} aria-labelledby="auth-title">
    <div className="auth-layout">
      <aside className="auth-story">
        <div className="auth-story-top"><span className="auth-story-dot" /> A GOOD PLACE TO START <Sparkles size={17} aria-hidden="true" /></div>
        <h2>{story}</h2>
        <p>Thoughtful templates and useful little tools. A head start for the things you want to make.</p>
        <div className="auth-art" aria-hidden="true">
          <div className="auth-art-grid" />
          <div className="auth-art-orbit" />
          <div className="auth-art-card auth-art-card-back"><span className="auth-art-mini-title">YOUR NEXT CHAPTER</span><div className="auth-art-warm-shape" /><span className="auth-art-card-caption">A fresh perspective.</span></div>
          <div className="auth-art-card auth-art-card-front"><div className="auth-art-browser"><i /><i /><i /><span>make something yours</span><ArrowUpRight size={12} /></div><div className="auth-art-content"><span className="auth-art-mini-title">THE START OF SOMETHING GOOD</span><strong>Less setup.<br /><em>More possibility.</em></strong><div className="auth-art-lines"><i /><i /></div><span className="auth-art-pill">A little head start <ArrowUpRight size={12} /></span></div></div>
          <span className="auth-art-sticker"><Check size={16} /> Ready for your ideas</span>
          <span className="auth-art-spark">✳</span>
        </div>
        <div className="auth-story-bottom"><span><Layers3 size={16} /> Finds worth keeping.</span><span><Download size={16} /> Yours to build with.</span></div>
      </aside>
      <div className="auth-form-panel">
        <button type="button" onClick={onBack} className="auth-back"><ArrowLeft size={15} /> Back to the collection</button>
        <div className="auth-form-intro"><p className="auth-eyebrow">{eyebrow}</p><h1 id="auth-title">{title}</h1><p>{description}</p></div>
        {children}
        {footer && <div className="auth-form-footer">{footer}</div>}
      </div>
    </div>
  </section>;
}
