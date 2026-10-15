// English for every Turkish UI text, one file per area of the app. tests/i18n.test.ts checks that each
// t()/tk() key in the sources has an entry here, that placeholders match and that no entry is unused.
import type { Dict } from '../types';
import common from './common';
import core from './core';
import integration from './integration';
import pagesA from './pages-a';
import pagesB from './pages-b';
import automation from './automation';

export const EN: Dict = { ...common, ...core, ...integration, ...pagesA, ...pagesB, ...automation };

/** Per file, for the duplicate check in the tests. */
export const EN_PARTS: Record<string, Dict> = { common, core, integration, 'pages-a': pagesA, 'pages-b': pagesB, automation };
