import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import '../styles/content.css';

export interface FAQItem { question: string; answer: string; category?: string; }
interface FAQAccordionProps { items: FAQItem[]; allowMultiple?: boolean; className?: string; }
export const FAQAccordion: React.FC<FAQAccordionProps> = ({ items, allowMultiple = false, className = '' }) => {
  const [openQuestions, setOpenQuestions] = useState<string[]>(() => items[0] ? [items[0].question] : []);
  const instance = useId().replace(/:/g, ''), reducedMotion = useReducedMotion();
  function toggle(question: string) {
    setOpenQuestions(previous => previous.includes(question) ? previous.filter(value => value !== question) : allowMultiple ? [...previous, question] : [question]);
  }
  return <div className={'content-accordion ' + className}>{items.map((item, index) => {
    const open = openQuestions.includes(item.question), buttonId = instance + '-question-' + index, panelId = instance + '-answer-' + index;
    return <div key={item.question} className={'content-accordion-item' + (open ? ' is-open' : '')}><button id={buttonId} type="button" onClick={() => toggle(item.question)} aria-expanded={open} aria-controls={panelId}><span>{item.question}</span><span className="content-accordion-chevron" aria-hidden="true"><ChevronDown size={18} /></span></button><AnimatePresence initial={false}>{open && <motion.div id={panelId} role="region" aria-labelledby={buttonId} initial={reducedMotion ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .2 }}><div className="content-accordion-answer">{item.answer}</div></motion.div>}</AnimatePresence></div>;
  })}</div>;
};
