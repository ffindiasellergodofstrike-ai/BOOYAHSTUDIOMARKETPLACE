export type ProductType = 'DOWNLOAD' | 'VIDEO' | 'SCRIPT' | 'TOOL' | 'RESOURCE' | 'OTHER';

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export type DeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED' | 'REVOKED';
export type DownloadStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'REVOKED';

export interface ProductFaq {
  question: string;
  answer: string;
}

export interface ProductChangelog {
  version: string;
  date: string;
  changes: string[];
}

export interface Product {
  sellerId?: string;
  sellerName?: string;
  creatorSlug?: string;
  isPlatformProduct?: boolean;
  membershipEligible?: boolean;
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  categoryLabel: string;
  productType: ProductType;
  price: number;
  originalPrice?: number;
  rating?: number;
  reviewCount?: number;
  image: string;
  gallery?: string[];
  fileFormat?: string;
  fileSize?: string;
  downloadUrl?: string;
  videoAccessUrl?: string;
  videoDuration?: string;
  version?: string;
  requirements?: string[];
  licenseTerms?: string;
  features: string[];
  whatsIncluded: string[];
  faqs?: ProductFaq[];
  changelog?: ProductChangelog[];
  previewUrl?: string;
  status: 'active' | 'archived';
  tags: string[];
  isFeatured?: boolean;
  isNew?: boolean;
  updatedAt?: string;
  releasedAt?: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  iconName: string;
  productCount: number;
  featuredTags: string[];
  color: string;
  bgLight: string;
}

export interface CartItem {
  product: Product;
  price: number;
  quantity: number;
  addedAt: string;
}

export interface WishlistItem {
  productId: string;
  product: Product;
  addedAt: string;
}

export interface User {
  role?: 'customer' | 'admin';
  id: string;
  name: string;
  email: string;
  mobile?: string;
  username?: string;
  avatar?: string;
  joinedDate?: string;
  createdAt?: string;
  company?: string;
  country?: string;
}

export interface UserCredentials {
  passwordHash: string;
}

export interface UserSettings {
  emailNotifications: boolean;
  orderAlerts: boolean;
  newsletter: boolean;
  theme?: 'light' | 'dark' | 'system';
}

export interface UserDownloadItem {
  id: string;
  downloadId?: string;
  orderId: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  productImage: string;
  category: string;
  version?: string;
  fileSize?: string;
  fileFormat?: string;
  downloadUrl?: string;
  status: DownloadStatus;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  productTitle: string;
  productSlug: string;
  productImage: string;
  category: string;
  productType?: ProductType;
  price: number;
  quantity?: number;
  downloadUrl?: string;
  fileSize?: string;
  version?: string;
  fileFormat?: string;
  accessKey?: string;
  refunded?: boolean;
  paidAmountPaise?: number;
  refundedAmountPaise?: number;
  downloadStatus?: DownloadStatus;
  product?: Product;
}

export interface Order {
  paymentEnvironment?: 'test' | 'live';
  id: string;
  userId: string;
  orderNumber: string;
  date: string;
  createdAt?: string;
  customerEmail: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  downloadStatus: DownloadStatus;
  customer: {
    fullName: string;
    email: string;
    phone?: string;
    company?: string;
    country: string;
  };
  items: (OrderItem & {
    product: Product;
    quantity?: number;
  })[];
  subtotal: number;
  discount: number;
  discountCode?: string;
  tax: number;
  total: number;
  paymentMethod: string;
  transactionId?: string;
  paymentProvider?: string;
  invoiceNumber?: string;
  paymentVerifiedAt?: string;
  paymentInitiatedAt?: string;
  paymentInitiationIp?: string | null;
  termsAccepted?: boolean;
  termsAcceptedAt?: string;
  termsAcceptedPolicies?: string[];
  termsDocumentUrl?: string;
  fulfilledAt?: string;
  deliveredAt?: string;
  emailDelivery?: {
    status: 'sent' | 'failed' | 'not_configured';
    attempts: number;
    lastAttemptAt: string;
    sentAt?: string;
    emailId?: string;
    message?: string;
    providerStatus?: 'accepted' | 'delayed' | 'delivered' | 'bounced' | 'failed' | 'complained' | 'suppressed';
  };
}

export interface Coupon {
  code: string;
  discountPercent: number;
  description: string;
  minSpend?: number;
  active?: boolean;
  expiresAt?: string;
}
