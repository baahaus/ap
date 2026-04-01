import { run } from './index.js';

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
