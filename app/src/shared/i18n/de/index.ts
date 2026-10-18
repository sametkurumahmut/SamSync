// German for every Turkish UI text, in the same files as en/. tests/i18n.test.ts checks that every English
// entry has a German one with the same placeholders; at run time a missing one falls back to English.
import type { Dict } from '../types';
import common from './common';
import core from './core';
import integration from './integration';
import pagesA from './pages-a';
import pagesB from './pages-b';
import automation from './automation';
import sync from './sync';

export const DE: Dict = { ...common, ...core, ...integration, ...pagesA, ...pagesB, ...automation, ...sync };
