import { BUSINESS } from '../src/config/business';
import { FirebaseRtdb } from './firebaseRtdb';
import { PRODUCTS } from '../src/data/products';
import { isBrowserSafeAssetUrl, normalizeProductAssets } from './productCatalog';

export async function runServerSeed() {
  try {
    // 1. Add any missing built-in products without overwriting Admin edits.
    const existingProducts = await FirebaseRtdb.get<Record<string, any>>('products');
    const existingProductList = existingProducts
      ? (Array.isArray(existingProducts) ? existingProducts : Object.values(existingProducts))
      : [];
    const existingById = new Map(
      existingProductList
        .filter((product: any) => product?.id)
        .map((product: any) => [product.id, product])
    );

    for (const p of PRODUCTS) {
      const prod = normalizeProductAssets(p as any);
      const existing = existingById.get(prod.id) as any;

      if (!existing) {
        const productRecord = {
          ...prod,
          createdAt: prod.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'published',
          stock: prod.stock !== undefined ? prod.stock : 999,
          unlimitedStock: true,
        };
        await FirebaseRtdb.set(`products/${prod.id}`, productRecord);
        continue;
      }

      const hasUnsafeImage = !isBrowserSafeAssetUrl(existing.image);
      const hasUnsafeGallery = !Array.isArray(existing.gallery)
        || existing.gallery.length === 0
        || existing.gallery.some((item: unknown) => !isBrowserSafeAssetUrl(item));
      const hasLegacyLicenseFields = 'licenseTypes' in existing
        || 'licenseTerms' in existing
        || 'extendedPrice' in existing;
      if (hasUnsafeImage || hasUnsafeGallery || hasLegacyLicenseFields) {
        const repaired = normalizeProductAssets(existing, prod);
        await FirebaseRtdb.set(`products/${prod.id}`, repaired);
      }
    }

    // 2. Seed Coupons if empty
    const existingCoupons = await FirebaseRtdb.get<Record<string, any>>('coupons');
    if (!existingCoupons || Object.keys(existingCoupons).length === 0) {
      console.log('Seeding initial coupons into Firebase RTDB...');
      const defaultCoupons = [
        { id: 'coup_1', code: 'SAVE10', discountPercent: 10, description: '10% off your entire order', minSpend: 0, active: true, usageCount: 0, usageLimit: 1000 },
        { id: 'coup_2', code: 'DIGITAL20', discountPercent: 20, description: '20% off for developer community', minSpend: 500, active: true, usageCount: 0, usageLimit: 500 },
        { id: 'coup_3', code: 'WELCOME100', discountPercent: 0, flatAmount: 100, description: '₹100 flat discount', minSpend: 400, active: true, usageCount: 0, usageLimit: 200 },
      ];
      for (const coup of defaultCoupons) {
        await FirebaseRtdb.set(`coupons/${coup.id}`, coup);
      }
    }

    // 3. Seed Settings if empty
    const existingSettings = await FirebaseRtdb.get<any>('settings');
    if (!existingSettings) {
      console.log('Seeding initial store settings...');
      await FirebaseRtdb.set('settings', {
        storeName: 'BOOYAH STUDIO',
        supportEmail: 'connectbooyahstudio@gmail.com',
        supportPhone: '+91 9208661701',
        appUrl: 'https://www.booyahstudio.shop/',
        paymentEnvironment: 'test',
        maintenanceMode: false,
        featuredProductIds: ['linknest-pro'],
        termsContent: 'Standard terms and conditions for digital downloads and licensing...',
        privacyContent: 'Your privacy is important to us. We protect your data securely...',
        refundContent: 'Digital products are non-refundable once downloaded unless defective...',
      });
    }

    await FirebaseRtdb.setMultiple({ 'settings/storeName': BUSINESS.name, 'settings/supportEmail': BUSINESS.email, 'settings/supportPhone': BUSINESS.phone, 'settings/appUrl': BUSINESS.url, 'settings/businessAddress': BUSINESS.address });

    console.log('Server seed completed successfully.');
  } catch (err) {
    console.warn('Server seed warning:', err);
  }
}
