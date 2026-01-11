#!/usr/bin/env node
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register ts-node ESM loader using the current working directory as base
register('ts-node/esm.mjs', pathToFileURL(process.cwd()));

// Run the TS consolidation test
await import('./runConsolidationTest.ts');
