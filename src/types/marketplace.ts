import type { Product } from './index';

export type MarketplaceGateway = 'cashfree' | 'razorpay' | 'easebuzz';
export type CreatorStatus = 'pending' | 'approved' | 'suspended' | 'rejected';
export type ListingStatus = 'draft' | 'pending' | 'active' | 'rejected' | 'archived';
export interface CreatorProviderAccount {
  reference?: string;
  status: 'pending' | 'verified' | 'rejected';
  environment: 'test' | 'live';
  verifiedAt?: string;
  updatedAt: string;
}
export interface CreatorBusinessDisclosure {
  businessName: string;
  businessAddress: string;
  supportEmail: string;
  supportPhone: string;
  grievanceName: string;
}
export interface PublicCreator {
  id: string;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl?: string;
  isPlatform?: boolean;
  productCount?: number;
  publicBusiness?: CreatorBusinessDisclosure;
}
export interface CreatorProfile extends PublicCreator {
  userId: string;
  status: CreatorStatus;
  createdAt: string;
  updatedAt: string;
  reviewReason?: string;
  agreementVersion: string;
  agreementAcceptedAt?: string;
  kyc: { status: 'not_submitted' | 'submitted'; panLast4?: string; bankLast4?: string; submittedAt?: string };
  providerAccounts: Partial<Record<MarketplaceGateway, CreatorProviderAccount>>;
}
export interface CreatorListing extends Omit<Product, 'status'> {
  sellerId: string;
  sellerName: string;
  creatorSlug: string;
  status: ListingStatus;
  membershipEligible: boolean;
  reviewReason?: string;
  createdAt: string;
  updatedAt: string;
  file: { uploaded: boolean; published?: boolean; fileName?: string; size?: number; uploadedAt?: string };
}
export interface CreatorOrderSnapshot {
  sellerId: string;
  sellerName: string;
  creatorSlug: string;
  commissionBps: number;
  grossPaise: number;
  commissionPaise: number;
  sellerPaise: number;
  provider: MarketplaceGateway;
  providerAccountId: string;
  agreementVersion: string;
}
export interface CreatorSummary {
  orders: number;
  paidOrders: number;
  grossPaise: number;
  commissionPaise: number;
  sellerPaise: number;
  refundPaise: number;
  payablePaise: number;
  productLimit: number;
  activeProducts: number;
}
export interface CreatorLedgerEntry {
  orderId: string;
  sellerId: string;
  provider: MarketplaceGateway;
  providerPaymentId: string;
  grossPaise: number;
  commissionPaise: number;
  sellerPaise: number;
  refundedPaise: number;
  refundSellerPaise: number;
  payablePaise: number;
  settlementStatus: 'pending_provider' | 'review_required';
  createdAt: string;
  updatedAt: string;
}
