import { Store } from './store';
import { isSupabaseAdminConfigured } from './supabase';
import { COMPANY_CREATOR } from './creatorMarketplace';
import { isCreatorSlug } from '../src/config/creatorRoutes';
import type { PublicCreator } from '../src/types/marketplace';

/** Only allowlisted published profile fields cross the server/HTML boundary. */
export async function getPublicCreatorProfiles(): Promise<PublicCreator[]> {
  if (!isSupabaseAdminConfigured()) return [COMPANY_CREATOR];
  const records = await Store.get<Record<string, any>>('marketplace/creators');
  return [COMPANY_CREATOR, ...Object.values(records || {}).filter(record => record?.status === 'approved' && isCreatorSlug(record.slug) && record.publicBusiness).map(record => ({
    id: record.id, slug: record.slug, displayName: record.displayName, headline: record.headline || '', bio: record.bio || '',
    ...(record.avatarUrl ? { avatarUrl: record.avatarUrl } : {}),
    publicBusiness: { businessName: record.publicBusiness.businessName, businessAddress: record.publicBusiness.businessAddress,
      supportEmail: record.publicBusiness.supportEmail, supportPhone: record.publicBusiness.supportPhone, grievanceName: record.publicBusiness.grievanceName },
  }))];
}
