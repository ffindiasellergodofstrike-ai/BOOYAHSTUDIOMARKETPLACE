import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderMarketplaceSql, FRESH_SETUP_FILES, UPGRADE_SETUP_FILES } from '../server/sqlPreparation';

const output = resolve(process.cwd(), 'build');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'marketplace-fresh.sql'), renderMarketplaceSql('fresh'));
writeFileSync(resolve(output, 'marketplace-upgrade.sql'), renderMarketplaceSql('upgrade'));
console.log(JSON.stringify({
  files: [
    { path: 'build/marketplace-fresh.sql', use: 'A new, separate Supabase project', migrations: FRESH_SETUP_FILES.length },
    { path: 'build/marketplace-upgrade.sql', use: 'The existing marketplace after its baseline and 20261023 migrations', migrations: UPGRADE_SETUP_FILES.length },
  ],
  next: 'Back up and review, then apply ONLY the matching file in Supabase SQL Editor. Run pnpm setup:check --online after environment configuration.',
  executedDatabaseCommands: false,
}, null, 2));
