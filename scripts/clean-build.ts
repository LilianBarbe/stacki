// A clean output tree prevents removed modules and obsolete renderer bundles
// from entering the next package. Resolve from this script, never the shell cwd.
import { rm } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
