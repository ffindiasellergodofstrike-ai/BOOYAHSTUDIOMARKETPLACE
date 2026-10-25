import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { FAQAccordion, type FAQItem } from '../components/FAQAccordion';
import { useApp } from '../context/AppContext';
import { BUSINESS } from '../config/business';
import '../styles/content.css';

const faqs: FAQItem[] = [
  { category: 'Getting started', question: `What will I find at ${BUSINESS.name}?`, answer: 'Website templates and source-code packages for your next project. Each product page explains its included files, features, requirements and license so you can choose the right fit.' },
  { category: 'Downloads', question: 'Where do I find my purchased files?', answer: 'Once your payment is confirmed, sign in with the email you used for your order and open your account. Your purchased downloads and receipts are kept there. Your confirmation email also links to your purchased downloads. If payment confirmation or file preparation is delayed, allow up to 24 hours and contact us if the purchase remains unavailable.' },
  { category: 'Downloads', question: 'What if my download is missing?', answer: 'Check your order in your account first. If payment is confirmed but your files are still unavailable, contact us with your order number and the email you used at checkout.' },
  { category: 'Payments', question: 'How can I pay?', answer: 'The available payment methods are shown at checkout. Prices are in INR and checkout is available to customers in India. You can review your final total before making a payment.' },
  { category: 'Refunds', question: 'Can I cancel an order or request a refund?', answer: 'Contact us before delivery to request cancellation. Duplicate charges, non-delivery, wrong files and unresolved material defects may qualify for a refund. Change-of-mind refunds are generally unavailable after delivery. We review requests within 2 business days and initiate approved refunds within 5 business days using the original payment route. Bank credit usually takes a further 5–7 business days; provider and bank delays may take longer. Applicable consumer rights remain available. Please read our Refund, Cancellation & Payment Policy for the full details.' },
  { category: 'Using your template', question: 'Who creates the products?', answer: `The original ${BUSINESS.name} products and store content are created by and owned by ${BUSINESS.owner}, Owner of ${BUSINESS.name}. Third-party libraries and other lawfully included components retain their own copyright notices and license terms. A purchase provides the stated product license, not copyright ownership.` },
  { category: 'Using your template', question: 'Can I make a template my own?', answer: 'Yes, within the product license and any third-party licenses. You can customize the included files for the permitted use. Hosting, backend integrations and custom development are not included unless the listing says otherwise. Source packages cannot be redistributed or resold as competing templates.' },
  { category: 'Using your template', question: 'Are future updates included?', answer: 'Update and support terms are listed on each product page. A lifetime update commitment applies only where it is explicitly included with that product.' },
  { category: 'Payments', question: 'Do you keep my payment details?', answer: `Payment details are entered on the payment provider’s checkout page. ${BUSINESS.name} does not store full card numbers, CVVs, OTPs or UPI PINs. Our support team will never need these details.` },
  { category: 'Getting started', question: 'How can I reach you?', answer: 'Email ' + BUSINESS.email + ' or message us on WhatsApp at ' + BUSINESS.phone + '. You can also send a message from our Contact page.' },
];

export const FAQPage: React.FC = () => {
  const { navigate } = useApp();
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all');
  const categories = useMemo(() => ['all', ...new Set(faqs.map(item => item.category!))], []);
  const matches = faqs.filter(item => (category === 'all' || item.category === category) && (item.question + ' ' + item.answer).toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="content-page faq-page">
    <header className="content-intro content-intro-centered"><span className="content-kicker">A FEW HELPFUL ANSWERS</span><h1>Less wondering.<br /><em>More creating.</em></h1><p className="content-lead">From choosing a template to finding your files,<br />here’s a good place to start.</p>
      <div className="faq-search"><Search size={20} strokeWidth={1.7} /><input type="search" aria-label="Search help and FAQs" placeholder="Try “downloads” or “payment”…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={18} /></button>}</div>
    </header>
    <div className="faq-layout"><aside className="faq-categories"><p>Explore by topic</p><div role="group" aria-label="FAQ topics">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item === 'all' ? 'All questions' : item}<span>{item === 'all' ? faqs.length : faqs.filter(faq => faq.category === item).length}</span></button>)}</div></aside><section className="faq-results" aria-label="Answers"><p className="faq-result-count" role="status">{matches.length} {matches.length === 1 ? 'answer' : 'answers'}{query.trim() ? ' for “' + query.trim() + '”' : ' to get you started'}</p>{matches.length ? <FAQAccordion items={matches} allowMultiple /> : <div className="faq-no-results"><Search size={28} /><h2>Let’s try another search.</h2><p>We couldn’t find a match. Try a different word or ask us directly.</p><button type="button" className="content-text-link" onClick={() => { setQuery(''); setCategory('all'); }}>Show all questions <ArrowUpRight size={16} /></button></div>}</section></div>
    <section className="content-help-callout"><div><span className="content-kicker">STILL LOOKING FOR AN ANSWER?</span><h2>Let’s figure it out together.</h2><p>Get in touch about a template, your order or your downloads.</p></div><button type="button" className="content-button" onClick={() => navigate('/contact')}>Talk to us <ArrowUpRight size={18} /></button></section>
  </div>;
};
