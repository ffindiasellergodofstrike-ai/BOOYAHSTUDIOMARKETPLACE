import { Product, Category, Coupon } from '../types';
import { NEW_PRODUCTS } from './newProducts';

export const CATEGORIES: Category[] = [
  {
    id: 'templates',
    slug: 'templates',
    name: 'Website Templates',
    shortName: 'Templates',
    description: 'Modern, responsive website & landing page templates for creators, freelancers, and digital stores.',
    iconName: 'Layout',
    productCount: 1,
    featuredTags: ['Bio Link', 'Digital Store', 'HTML/CSS/JS', 'Responsive'],
    color: 'from-blue-500 to-indigo-600',
    bgLight: 'bg-blue-50 text-blue-700',
  },
  {
    id: 'scripts',
    slug: 'scripts',
    name: 'Scripts & Tools',
    shortName: 'Scripts',
    description: 'Automation scripts, web utilities, and developer tools.',
    iconName: 'Code',
    productCount: 0,
    featuredTags: ['Automation', 'Tools', 'NodeJS', 'Python'],
    color: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50 text-emerald-700',
  },
];

const linknestCover = '/product-images/linknest-pro.jpg';
const neuraAiCover = '/product-images/neura-ai.png';
const finoraCover = '/product-images/finora.png';
const learnifyCover = '/product-images/learnify.png';
const veloraCover = '/product-images/velora.png';

export const PRODUCTS: Product[] = [
  ...NEW_PRODUCTS,
  {
    id: 'linknest-pro',
    slug: 'linknest-pro',
    title: 'LinkNest Pro — Bio Link & Digital Store',
    shortDescription:
      'Create your own professional bio link page and showcase your digital products, social links, WhatsApp, email and payment links — all in one place.',
    description:
      'LinkNest Pro is a modern, responsive personal bio and digital-store website template designed for creators, freelancers, developers, influencers and small businesses.\n\nTurn one simple link into your own professional online profile where visitors can:\n\n👤 View your profile & bio\n🔗 Access all your important links\n📱 Connect through WhatsApp\n📧 Contact you by email\n🌐 Visit your website and social profiles\n🛍️ Browse your digital products\n💰 See product prices\n🔥 Click Buy Now and continue to your payment/checkout page\n\nNo monthly subscription. No framework required. Just customize, deploy and use.',
    category: 'templates',
    categoryLabel: 'Website Templates',
    productType: 'DOWNLOAD',
    price: 550,
    image: linknestCover,
    gallery: [
      linknestCover
    ],
    fileFormat: 'HTML, CSS, JS (ZIP Archive)',
    fileSize: '6.7 KB',
    previewUrl: '/demos/linknest-pro/',
    version: '',
    features: [
      'Responsive Mobile & Desktop Layout',
      'Personal Profile & Bio Showcase',
      'Digital Product Cards with Pricing',
      'Direct Buy Now / Payment Link Support',
      'WhatsApp & Email Direct Action Buttons',
      'Social Media Links Integration',
      'Dark & Light Mode Theme Switcher',
      'SEO-Optimized Meta & OpenGraph Tags',
      'Zero Frameworks / Pure Vanilla JS & CSS'
    ],
    whatsIncluded: [
      'Complete HTML/CSS/JS source code',
      'Responsive mobile & desktop design',
      'Digital product showcase',
      'Product pricing section',
      'Buy Now / payment-link support',
      'Social media links',
      'WhatsApp & Email buttons',
      'Dark/Light mode',
      'SEO-ready metadata',
      'Favicon',
      'Free deployment guide',
      'Product & payment setup guide',
      'Customization guide',
      'Setup and customization guide'
    ],
    requirements: [
      'Any modern web browser (Chrome, Safari, Firefox, Edge)',
      'Basic text editor (VS Code, Notepad++, or Sublime Text) for editing links and text',
      'Free web hosting (Vercel, Netlify, GitHub Pages, or Cloudflare Pages)'
    ],
    faqs: [
      {
        question: 'Do I need a monthly subscription to use LinkNest Pro?',
        answer: 'The purchase covers the listed files and their stated license. Third-party hosting, services and future updates are not included unless stated.'
      },
      {
        question: 'How do customers buy my products?',
        answer: 'You can link each product item to your preferred payment gateway (Stripe, PayPal, Razorpay, UPI, BuyMeACoffee, Gumroad) directly via simple link URLs.'
      },
      {
        question: 'Can I host it on my own custom domain?',
        answer: 'Yes! You can host LinkNest Pro on any custom domain or sub-domain with free hosting platforms like Vercel, Netlify, or GitHub Pages.'
      },
      {
        question: 'What happens if I lose my download link?',
        answer: 'No worries! You can access all your purchased products anytime by logging into your account dashboard on Booyahstudio. Your digital library is permanently stored in your account.'
      },
      {
        question: 'Do I need to know coding to use this template?',
        answer: 'Basic knowledge of HTML/CSS is helpful if you want to make deep customizations, but for simply changing links, text, and images, you just need a basic text editor. We provide a step-by-step guide to help you.'
      },
      {
        question: 'Is the template SEO friendly?',
        answer: 'Yes, LinkNest Pro is built with clean HTML5 semantic structure and includes pre-configured meta tags for SEO and social media (OpenGraph) sharing.'
      },
      {
        question: 'Is there a refund policy?',
        answer: 'Purchases are generally non-refundable after delivery or access, subject to law and legitimate exceptions including non-delivery, duplicate charges, wrong files, unresolved material defects and material misdescription. See the Refund & Cancellation Policy.'
      }
    ],
    status: 'active',
    tags: ['Bio Link', 'Digital Store', 'Landing Page', 'Website Template', 'HTML/CSS/JS', 'Creator Portfolio', 'Link in Bio'],
    isFeatured: true,
    isNew: true,
    releasedAt: '2026-09-20',
    updatedAt: '2026-09-21'
  },
  {
    id: 'neura-ai',
    slug: 'neura-ai',
    title: 'NeuraAI — Premium AI SaaS Template',
    shortDescription:
      'A premium, modern AI SaaS website template designed for AI startups, automation platforms, productivity tools, and next-generation software products.',
    description:
      'NeuraAI — Premium AI SaaS Website is a professionally designed, modern website template built for AI startups, SaaS companies, automation platforms, AI tools, and technology products.\n\nIt combines a sophisticated visual system with clear product storytelling, feature sections, pricing layouts, integrations, testimonials, FAQs, and conversion-focused call-to-action sections.\n\nThe template is designed to help you launch a professional AI/SaaS website quickly while keeping the codebase clean, responsive, customizable, and deployment-ready.\n\nWhether you\'re launching an AI writing tool, automation platform, productivity application, analytics product, or another SaaS product, NeuraAI provides a strong foundation that can be customized to your brand.',
    category: 'templates',
    categoryLabel: 'Website Templates',
    productType: 'DOWNLOAD',
    price: 750,
    image: neuraAiCover,
    gallery: [
      neuraAiCover
    ],
    fileFormat: 'React/Vite-ready (ZIP Archive)',
    fileSize: '1.2 MB',
    previewUrl: '/demos/neura-ai/',
    version: '1.0.0',
    features: [
      '🤖 AI SaaS Design: Modern interface specifically designed for AI and SaaS products.',
      '🌙 Dark Modern UI: Premium dark-first visual system with subtle gradients, borders, and modern typography.',
      '⚡ SaaS Product Sections: Professionally structured sections for AI features, use cases, pricing, and integrations.',
      '📊 Dashboard Preview: Realistic dashboard-style interface with analytics, AI workspace, and metrics.',
      '💳 Pricing Section: Ready-made monthly/yearly pricing structure for Free, Pro, Business, and Enterprise.',
      '📱 Fully Responsive: Optimized layout for desktop, laptop, tablet, and mobile browsers.'
    ],
    whatsIncluded: [
      'React & Vite-ready source structure',
      'CSS/Tailwind styling layout config',
      'Reusable premium UI components',
      'Responsive dashboard preview mockups',
      'Feature icons & SVG assets',
      'Demo content and configuration',
      'Full deployment & customization guides'
    ],
    requirements: [
      'Modern desktop or laptop',
      'Node.js 18+ and npm 9+',
      'VS Code or another code editor',
      'Modern web browser (Chrome, Edge, Firefox, Safari)'
    ],
    faqs: [
      {
        question: 'What is NeuraAI?',
        answer: 'NeuraAI is a premium AI SaaS website template designed for AI startups, SaaS businesses, automation tools, productivity platforms, and technology products.'
      },
      {
        question: 'Is this a complete website template?',
        answer: 'Yes. The package contains the editable website source files and required frontend assets.'
      },
      {
        question: 'Can I change the brand name?',
        answer: 'Yes. You can replace the NeuraAI branding with your own company, product, or startup name.'
      },
      {
        question: 'Can I change the colors and design?',
        answer: 'Yes. The styling is customizable, allowing you to modify colors, typography, spacing, content, and other visual elements.'
      },
      {
        question: 'Is it mobile responsive?',
        answer: 'Yes. The website is designed to adapt to desktop, tablet, and mobile screen sizes.'
      },
      {
        question: 'Can I deploy it on Vercel?',
        answer: 'Yes. The project is designed to be compatible with Vercel deployment.'
      },
      {
        question: 'Can I use it for my SaaS business?',
        answer: 'Yes. You can customize the template for your own SaaS, AI, software, automation, or technology project. The original package may not be redistributed or resold as a competing product.'
      },
      {
        question: 'Does it include a real AI backend?',
        answer: 'No. NeuraAI is a frontend website template. AI APIs, authentication, databases, subscriptions, and other backend services need to be connected separately if required.'
      },
      {
        question: 'Does it include a real payment gateway?',
        answer: 'No. The template provides the frontend pricing/checkout presentation. A real payment provider must be integrated separately.'
      },
      {
        question: 'Can I connect my own API?',
        answer: 'Yes. The frontend structure can be connected to your own API, backend, database, AI provider, authentication system, or other services.'
      },
      {
        question: 'Do I need coding knowledge?',
        answer: 'Basic web-development knowledge is recommended for advanced customization. The included documentation can help with setup and deployment.'
      },
      {
        question: 'Are the included images and content real?',
        answer: 'Demo content is fictional and intended for showcasing the template. Replace it with your own content and assets you have permission to use before publishing.'
      },
      {
        question: 'Can I sell this template again?',
        answer: 'No. You may customize the purchased template for your own project, but you should not redistribute, resell, or repackage the original source files as another competing template.'
      },
      {
        question: 'Is technical support included?',
        answer: 'Product-specific support can be provided according to the support terms listed on the product page.'
      },
      {
        question: 'Is a refund available?',
        answer: 'Digital-product refund eligibility is subject to the store\'s published Refund & Cancellation Policy and applicable payment-provider/legal requirements.'
      }
    ],
    status: 'active',
    tags: ['AI SaaS', 'Website Template', 'React', 'Tailwind CSS', 'Dark Mode', 'Product Dashboard', 'SaaS Landing Page'],
    isFeatured: true,
    isNew: true,
    releasedAt: '2026-09-22',
    updatedAt: '2026-09-22'
  },
  {
    id: 'finora',
    slug: 'finora',
    title: 'Finora — Premium Fintech Template',
    shortDescription:
      'Build a professional fintech presence with Finora — a modern responsive website template for digital banking, payments, investment platforms, financial SaaS, wallets and finance applications.',
    description:
      'Finora is a professional fintech website template created for modern financial technology businesses that need a trustworthy, premium, and conversion-focused online presence.\n\nThe design combines a clean financial interface with modern dashboards, analytics, payment-focused sections, investment visuals, pricing layouts, feature showcases, and responsive components.\n\nWhether you are launching a fintech startup, digital banking platform, digital wallet, or a financial SaaS, Finora provides a high-quality frontend starting point that saves dozens of hours of design and development time.',
    category: 'templates',
    categoryLabel: 'Website Templates',
    productType: 'DOWNLOAD',
    price: 1100,
    image: finoraCover,
    gallery: [
      finoraCover
    ],
    fileFormat: 'React/Vite-ready (ZIP Archive)',
    fileSize: '1.4 MB',
    previewUrl: '/demos/finora/',
    version: '1.0.0',
    features: [
      '💳 Fintech-Focused Design: Designed specifically around modern financial technology products and services.',
      '📊 Financial Dashboard: Professional dashboard layouts for displaying balances, transactions, and account activity.',
      '📈 Analytics & Charts: Visual sections suitable for financial analytics, trends, and business metrics.',
      '💰 Payment UI: Modern interfaces for presenting transfers, payments, balances, and payment-related workflows.',
      '🔐 Authentication Pages: Ready-made professional screens for Login and Sign Up screens.',
      '📱 Fully Responsive: Mobile-first optimized layouts for desktop, tablet, and mobile browsers.',
      '🌙 Dark & Light Mode: Premium visual modes to match different user preferences.'
    ],
    whatsIncluded: [
      'Complete React & Vite website structure',
      'JavaScript responsive source files',
      'Sleek Tailwind & CSS theme config',
      'Reusable premium UI components',
      'Pricing layout sections for subscription SaaS',
      'FAQ, Testimonials, and Contact form layouts',
      'Custom Fintech SVG icons and illustration elements',
      'Detailed customization & deployment guidance'
    ],
    requirements: [
      'Modern Windows, macOS, or Linux computer',
      'Node.js 18+ and npm 9+',
      'Git installed (recommended)',
      'VS Code or another modern text editor',
      'Modern web browser (Chrome, Edge, Firefox, Safari)'
    ],
    faqs: [
      {
        question: 'What is Finora?',
        answer: 'Finora is a premium fintech website template designed for financial technology startups, digital banking products, payment platforms, investment applications, and financial SaaS businesses.'
      },
      {
        question: 'Is Finora a complete banking application?',
        answer: 'No. Finora is a frontend website/template. Banking APIs, payment processing, authentication infrastructure, KYC, financial data providers, and backend services must be integrated separately.'
      },
      {
        question: 'Can I customize the brand name?',
        answer: 'Yes. You can replace the Finora branding, logo, colors, text, images, pricing and other content with your own brand.'
      },
      {
        question: 'Can I connect my own API?',
        answer: 'Yes. The frontend structure can be connected to your own backend APIs, payment services, financial-data providers, authentication system, or database.'
      },
      {
        question: 'Is payment processing included?',
        answer: 'No. The template provides payment/transaction-related UI. A real payment gateway or financial API must be integrated separately.'
      },
      {
        question: 'Is it responsive?',
        answer: 'Yes. The design is intended to work across desktop, tablet and mobile screen sizes.'
      },
      {
        question: 'Can I deploy it on Vercel?',
        answer: 'Yes. The project can be configured and deployed through a standard GitHub + Vercel workflow.'
      },
      {
        question: 'Can I use Finora for a fintech SaaS?',
        answer: 'Yes. The UI can be customized for fintech SaaS, payment platforms, finance management tools, investment products and similar applications.'
      },
      {
        question: 'Does Finora include a real financial backend?',
        answer: 'No. It is a website template. Real financial operations require your own secure backend and appropriate third-party services.'
      },
      {
        question: 'Can I change the colors and layout?',
        answer: 'Yes. The components, styling and visual system can be customized according to your brand.'
      },
      {
        question: 'Is the financial data real?',
        answer: 'No. Any financial figures or transaction information included in the template are demonstration content only.'
      },
      {
        question: 'Can I resell the template?',
        answer: 'The source package may be customized for your own project, but it should not be redistributed or resold as a competing template.'
      }
    ],
    status: 'active',
    tags: ['Fintech', 'Fintech SaaS', 'Digital Banking', 'Payment Gateway', 'Landing Page', 'React Template', 'Tailwind CSS'],
    isFeatured: true,
    isNew: true,
    releasedAt: '2026-09-22',
    updatedAt: '2026-09-22'
  },
  {
    id: 'learnify',
    slug: 'learnify',
    title: 'Learnify — Premium LMS Template',
    shortDescription:
      'Build a professional e-learning experience with Learnify — a modern responsive website template for online courses, instructors, academies, coaching businesses and digital education platforms.',
    description:
      'Learnify is a premium online education and Learning Management System (LMS) website template designed to create a professional learning experience for students, instructors, and education businesses.\n\nThe template provides a complete visual foundation for showcasing courses, instructors, learning paths, student progress, lessons, quizzes, certificates, pricing plans, and educational content.\n\nWhether you are launching an online academy, code camp, corporate training portal, or a coaching website, Learnify gives you a clean modern starting point with modular, reusable layouts.',
    category: 'templates',
    categoryLabel: 'Website Templates',
    productType: 'DOWNLOAD',
    price: 1400,
    image: learnifyCover,
    gallery: [
      learnifyCover
    ],
    fileFormat: 'React/Vite-ready (ZIP Archive)',
    fileSize: '1.6 MB',
    previewUrl: '/demos/learnify/',
    version: '1.0.0',
    features: [
      '🎓 Complete E-Learning Design: A professional education-focused interface designed around online courses.',
      '📚 Course Catalog: Showcase courses with categories, instructors, ratings, pricing, and difficulty levels.',
      '🔎 Course Search & Filters: Allow students to discover courses using real-time search and category filtering.',
      '👨‍🏫 Instructor Profiles: Dedicated instructor layouts for displaying biography, expertise, courses, and rating metrics.',
      '📊 Student Dashboard: A clean dashboard concept for displaying enrolled courses, recently accessed lessons, and progress indicators.',
      '📝 Lessons & Curriculum Layouts: Dedicated templates for video lessons, curriculum modules, and interactive learning materials.',
      '🏆 Quiz & Certificate UI: Built-in layout blocks for rendering course assessments and completion certificates.'
    ],
    whatsIncluded: [
      'Complete React & Vite educational structure',
      'JavaScript responsive source components',
      'Sleek Tailwind & CSS course interface configurations',
      'Modular student and instructor dashboards',
      'Quiz/assessment and certificate interfaces',
      'Interactive course categorization templates',
      'Course wishlist and bookmark layouts',
      'Detailed customization & Vercel deployment guides'
    ],
    requirements: [
      'Windows, macOS, or Linux computer',
      'Node.js 18+ and npm 9+',
      'Git installed (recommended)',
      'VS Code or another modern code editor',
      'Modern web browser (Chrome, Edge, Firefox, Safari)'
    ],
    faqs: [
      {
        question: 'What is Learnify?',
        answer: 'Learnify is a premium online course and e-learning website template designed for educators, instructors, academies, training companies and LMS businesses.'
      },
      {
        question: 'Is Learnify a complete LMS?',
        answer: 'No. Learnify is primarily a frontend website/template. A production LMS backend, database, authentication, video hosting and course-management system need to be integrated separately.'
      },
      {
        question: 'Can I sell courses using Learnify?',
        answer: 'Yes. The UI can be customized for paid courses, subscriptions, memberships or other education business models. Real payment functionality requires integration with your preferred payment gateway.'
      },
      {
        question: 'Does it include real course videos?',
        answer: 'No. Demo course content is placeholder content. You can connect your own video hosting or learning-content system.'
      },
      {
        question: 'Can I connect my own backend?',
        answer: 'Yes. The frontend can be connected to your own API, database, authentication system and LMS backend.'
      },
      {
        question: 'Can I customize the branding?',
        answer: 'Yes. You can change the logo, brand name, colors, typography, images, course information and other content.'
      },
      {
        question: 'Is Learnify mobile responsive?',
        answer: 'Yes. The interface is designed for desktop, tablet and mobile screen sizes.'
      },
      {
        question: 'Can I deploy Learnify on Vercel?',
        answer: 'Yes. The project can be configured for deployment through GitHub and Vercel.'
      },
      {
        question: 'Does Learnify include authentication?',
        answer: 'It includes authentication UI screens such as Login and Registration. Real authentication functionality requires backend/API integration.'
      },
      {
        question: 'Does it include a payment gateway?',
        answer: 'No. Payment-related UI can be included, but real payment processing must be connected separately.'
      },
      {
        question: 'Can I use it for a coaching website?',
        answer: 'Yes. Learnify can be adapted for coaching programs, training businesses, workshops, academies and instructor-led education platforms.'
      },
      {
        question: 'Can I use it for a school or university?',
        answer: 'Yes. The UI can be customized for schools, universities, training centers and educational institutions.'
      },
      {
        question: 'Can I change the courses and instructors?',
        answer: 'Yes. All demo course and instructor information should be replaced with your own content.'
      },
      {
        question: 'Can I resell the source code?',
        answer: 'The source may be customized for your own project, but it should not be redistributed or resold as a competing template.'
      }
    ],
    status: 'active',
    tags: ['LMS', 'E-learning', 'Online Course', 'Website Template', 'React', 'Tailwind CSS', 'Education Portal', 'Course Dashboard'],
    isFeatured: true,
    isNew: true,
    releasedAt: '2026-09-22',
    updatedAt: '2026-09-22'
  },
  {
    id: 'velora',
    slug: 'velora',
    title: 'Velora — Complete E-Commerce Template',
    shortDescription:
      'Build a premium online shopping experience with Velora — a complete responsive e-commerce frontend for fashion, electronics, beauty, lifestyle, accessories and modern retail brands.',
    description:
      'Velora is a premium complete e-commerce frontend template designed to provide a polished, high-end online shopping experience.\n\nInstead of being just a simple e-commerce landing page, Velora includes the complete customer-facing shopping journey — from discovering products and browsing categories to product details, wishlist, cart, checkout, account management and order tracking.\n\nIts modern visual system combines premium typography, spacious layouts, product-focused imagery, smooth interactions, responsive components and a conversion-focused shopping experience.',
    category: 'templates',
    categoryLabel: 'Website Templates',
    productType: 'DOWNLOAD',
    price: 5500,
    image: veloraCover,
    gallery: [
      veloraCover
    ],
    fileFormat: 'React/Vite-ready (ZIP Archive)',
    fileSize: '2.1 MB',
    previewUrl: '/demos/velora/',
    version: '1.0.0',
    features: [
      '🛍️ Complete Shopping Experience: A complete frontend shopping flow from product discovery to checkout and order confirmation.',
      '🛒 Product Catalog: Professional product grid with image sliders, discount pricing, wishlist toggles, and Quick View triggers.',
      '🔎 Search, Filtering & Sorting: Advanced sidebar search, sorting metrics, and filter options by price, rating, brand, and size.',
      '👕 Product Variants: Full UI options for colors, sizes, variant styles, and custom product quantities.',
      '🛒 Drawer Mini Cart & Checkout: Fully designed mini cart drawer with complete order summary and responsive checkout fields.',
      '👤 Customer Account Pages: Account dashboard detailing customer profile, order history, addresses, and order tracking timeline.',
      '📱 Fully Responsive: Optimized design for desktop, laptop, tablet, and mobile shopping devices.'
    ],
    whatsIncluded: [
      'Complete React & Vite storefront structure',
      'JavaScript responsive source components',
      'Premium CSS & Tailwind styling settings',
      'Curated mockup product datasets & assets',
      'Fully designed cart, checkout, and wishlist states',
      'Customer order tracking visual components',
      'Authentication UI (Login, Signup, Forgot password)',
      'Detailed installation, Vercel setup, and customization guides'
    ],
    requirements: [
      'Windows, macOS, or Linux computer',
      'Node.js 18+ and npm 9+',
      'Git installed (recommended)',
      'VS Code or another modern text editor',
      'Modern web browser (Chrome, Edge, Firefox, Safari)'
    ],
    faqs: [
      {
        question: 'What is Velora?',
        answer: 'Velora is a premium complete e-commerce frontend template designed for modern online stores and retail brands.'
      },
      {
        question: 'Is Velora a complete e-commerce backend?',
        answer: 'No. Velora provides the frontend shopping experience. Backend services such as databases, authentication, inventory, order processing and payment processing need to be integrated separately.'
      },
      {
        question: 'Can I use Velora for my clothing store?',
        answer: 'Yes. Velora is suitable for clothing, fashion, footwear, accessories and other retail businesses.'
      },
      {
        question: 'Can I use it for electronics?',
        answer: 'Yes. The product catalog and product-detail structure can be customized for electronics and technology products.'
      },
      {
        question: 'Does it include a payment gateway?',
        answer: 'No. The checkout contains payment-related UI. A real payment gateway must be connected separately.'
      },
      {
        question: 'Does it include real authentication?',
        answer: 'The package includes authentication UI screens. Real user authentication requires a backend or authentication service.'
      },
      {
        question: 'Can I connect Firebase or my own API?',
        answer: 'Yes. The frontend structure can be connected to Firebase, REST APIs, GraphQL APIs or another backend system.'
      },
      {
        question: 'Does it include an admin panel?',
        answer: 'The standard Velora package focuses on the customer-facing e-commerce store. An admin dashboard can be developed separately or added as an extended version.'
      },
      {
        question: 'Can I change the products?',
        answer: 'Yes. Demo products, images, prices, categories, descriptions and other content can be replaced with your own products.'
      },
      {
        question: 'Can I change the branding?',
        answer: 'Yes. You can customize the logo, colors, typography, content, images and overall visual identity.'
      },
      {
        question: 'Is Velora mobile responsive?',
        answer: 'Yes. The design is optimized for mobile, tablet and desktop shopping experiences.'
      },
      {
        question: 'Can I deploy it on Vercel?',
        answer: 'Yes. Velora is structured for a standard GitHub + Vercel deployment workflow.'
      },
      {
        question: 'Can I connect a real payment system?',
        answer: 'Yes. The checkout frontend can be connected to a compatible payment gateway through a secure backend integration.'
      },
      {
        question: 'Can I connect a real inventory system?',
        answer: 'Yes. Product and inventory data can be connected through your own backend/API.'
      },
      {
        question: 'Are the products and prices real?',
        answer: 'No. Demo products, prices, customer information and order data are placeholder content intended to demonstrate the template.'
      },
      {
        question: 'Can I resell the template?',
        answer: 'The source code may be customized for your own project, but it should not be redistributed or sold as a competing template.'
      }
    ],
    status: 'active',
    tags: ['E-Commerce', 'Shopping Cart', 'Store Template', 'React Template', 'Tailwind CSS', 'Checkout UI', 'Product Catalog', 'D2C Store'],
    isFeatured: true,
    isNew: true,
    releasedAt: '2026-09-22',
    updatedAt: '2026-09-22'
  },

];

export const COUPONS: Coupon[] = [
  {
    code: 'SAVE20',
    discountPercent: 20,
    description: '20% off any digital product on Booyahstudio',
  },
  {
    code: 'LAUNCH50',
    discountPercent: 50,
    description: '50% off launch discount',
    minSpend: 50,
  },
  {
    code: 'DEV30',
    discountPercent: 30,
    description: '30% developer discount',
    minSpend: 40,
  },
];
