import crypto from 'node:crypto';
import policies from '../src/data/policies.json';
export const policyDocuments = policies;
export const policyVersion = `2026-10-24-${crypto.createHash('sha256').update(JSON.stringify(policies)).digest('hex').slice(0, 12)}`;
