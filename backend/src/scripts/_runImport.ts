/**
 * _runImport.ts — run with ts-node from the backend/ directory
 *
 * Usage:
 *   npx ts-node src/scripts/_runImport.ts             # both
 *   npx ts-node src/scripts/_runImport.ts buses       # buses only
 *   npx ts-node src/scripts/_runImport.ts transmetro  # Transmetro only
 */

import { importBuses } from './importBuses';
import { importTransmetro } from './importTransmetro';

const arg = process.argv[2]?.toLowerCase();

async function main() {
  if (!arg || arg === 'buses') {
    console.log('=== Buses (AMBQ KMZ) ===');
    const r = await importBuses();
    console.log('BUSES DONE:', JSON.stringify(r));
  }

  if (!arg || arg === 'transmetro') {
    console.log('\n=== Transmetro ===');
    const r = await importTransmetro();
    console.log('TRANSMETRO DONE:', JSON.stringify(r));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e: Error) => { console.error('ERR:', e.message); process.exit(1); });
