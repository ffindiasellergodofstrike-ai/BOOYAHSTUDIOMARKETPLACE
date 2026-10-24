import React from 'react';
import { ArrowUpRight, Code2, Download, LifeBuoy, MapPin, Sparkles } from 'lucide-react';
import { BUSINESS } from '../config/business';
import { useApp } from '../context/AppContext';
import '../styles/content.css';

export const AboutPage: React.FC = () => {
  const { navigate } = useApp();
  const values = [
    { icon: Code2, title: 'A foundation, not a finish line.', body: 'Start with a template, explore the included source, and shape it around your own ideas. Each listing explains what comes with your purchase.' },
    { icon: Download, title: 'Your next step, made simple.', body: 'Once your payment is confirmed, find your purchased files and receipts together in your account.' },
    { icon: LifeBuoy, title: 'A real person to turn to.', body: 'Questions about a purchase, a download or the included documentation? Get in touch. We’ll help you find the next step.' },
  ];
  return <div className="content-page about-page">
    <section className="about-intro">
      <div className="content-intro-copy">
        <span className="content-kicker">OUR STORY</span>
        <h1>Good ideas deserve<br />a <em>good beginning.</em></h1>
        <p className="content-lead">A little less starting from scratch.<br />A little more making it your own.</p>
        <p className="content-body">{BUSINESS.name} is a digital marketplace based in Varanasi, India. Operated by {BUSINESS.owner}, it brings together original Booyahstudio products and independent creators’ digital collections. Every listing shows who published it and what your purchase includes.</p>
        <button type="button" className="content-button" onClick={() => navigate('/products')}>Explore the collection <ArrowUpRight size={18} /></button>
      </div>
      <div className="about-art" aria-hidden="true">
        <div className="about-art-label"><Sparkles size={16} /><span>ROOM FOR YOUR IDEAS</span><span>01 / ∞</span></div>
        <div className="about-paper about-paper-back"><span>YOUR NEXT CHAPTER</span><div className="about-paper-lines"><i /><i /><i /></div><span className="about-paper-sign">Made to be yours.</span></div>
        <div className="about-paper about-paper-front"><span>A BETTER START</span><div>What<br />will you<br /><em>make?</em></div><ArrowUpRight size={32} /></div>
        <div className="about-art-caption"><span className="about-art-dot" />FROM VARANASI, WITH POSSIBILITY.</div>
      </div>
    </section>

    <section className="about-values" aria-label="What to expect">
      {values.map(({ icon: Icon, title, body }, index) => <article className="content-feature" key={title}><div className="content-feature-top"><Icon size={23} strokeWidth={1.6} /><span>0{index + 1}</span></div><h2>{title}</h2><p>{body}</p></article>)}
    </section>

    <section className="about-bottom">
      <div><span className="content-kicker">THOUGHTFULLY DIGITAL</span><h2>Choose the right start<br />for your next project.</h2><p>Explore the demos, read what’s included, and check the requirements and license before you choose.</p><button type="button" className="content-text-link" onClick={() => navigate('/faq')}>A few helpful answers <ArrowUpRight size={17} /></button></div>
      <div className="about-business"><div className="content-business-heading"><MapPin size={20} /><span>Based in Varanasi, India</span></div><details open><summary>Business & contact details</summary><address>{BUSINESS.owner}, Owner of {BUSINESS.name}{BUSINESS.legalName ? <><br />{BUSINESS.legalName}</> : null}{BUSINESS.gstin ? <><br />GSTIN: {BUSINESS.gstin}</> : null}<br />{BUSINESS.address}<br /><a href={'mailto:' + BUSINESS.email}>{BUSINESS.email}</a><br /><a href={BUSINESS.phoneHref} target="_blank" rel="noopener noreferrer">{BUSINESS.phone}</a></address><p>Grievance contact: {BUSINESS.owner}, at the same email and address.</p></details><p>{BUSINESS.supportHours}</p><p>Digital products. Electronic delivery.<br />Checkout available in India, with prices in INR.</p><p>Original Booyahstudio products and platform content © {new Date().getFullYear()} {BUSINESS.owner}. Independent creators retain rights to their original products. Third-party components keep their own licenses and notices.</p></div>
    </section>
  </div>;
};
