import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const KEY_PAGES = [
  { name: 'home', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'music', path: '/music' },
  { name: 'playlists', path: '/playlists' },
  { name: 'search', path: '/users' },
];

test.describe('Accessibility audit — axe-core', () => {
  for (const page of KEY_PAGES) {
    test(`${page.name} page (${page.path})`, async ({ page: pwPage }) => {
      await pwPage.goto(page.path);
      // Wait for page to stabilize
      await pwPage.waitForLoadState('networkidle');
      
      const results = await new AxeBuilder({ page: pwPage })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      
      // Log violations for the report
      if (results.violations.length > 0) {
        console.log(`\n=== ${page.name} (${page.path}) — ${results.violations.length} violations ===`);
        for (const v of results.violations) {
          console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`);
          for (const node of v.nodes.slice(0, 3)) {
            console.log(`    - ${node.html?.slice(0, 120)}`);
          }
        }
      }
      
      // Don't fail the test — just report
      // We'll aggregate findings manually
      expect(results.violations.length).toBeLessThan(100); // sanity check
    });
  }
});
