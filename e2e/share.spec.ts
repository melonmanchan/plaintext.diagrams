import type { Page } from '@playwright/test';
import { expect, test } from './helpers';
import { ascii, seedDoc, shapes } from './helpers';

/** Slice of the window.__app test hook read by this spec. */
interface ShareHook {
  projects: { id: string; name: string }[];
  shareLink(): Promise<string>;
}

/** Test seam: the capture array installed on window by installCopyStub. */
interface CopyCapture { __copied: string[] }

/**
 * Stub navigator.clipboard.writeText to capture copies into window.__copied.
 * Installed as an init script, so the page is re-navigated to pick it up.
 */
async function installCopyStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    // Test seam: augment window with the capture array for later readback.
    const w = window as unknown as CopyCapture;
    w.__copied = copied;
    navigator.clipboard.writeText = (t: string): Promise<void> => {
      copied.push(t);
      return Promise.resolve();
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app !== undefined);
}

/** Open a URL in a SECOND browser context (cold start, isolated storage). */
async function openFresh(page: Page, url: string): Promise<Page> {
  const ctx = await page.context().browser()!.newContext();
  const opened = await ctx.newPage();
  await opened.goto(url);
  await opened.waitForFunction(() => window.__app !== undefined);
  return opened;
}

async function projectNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Test seam: __app is declared `unknown`; the app guarantees this getter.
    return (window.__app as ShareHook).projects.map((p) => p.name);
  });
}

/** Wait for the async #s= import to land as a second project. */
async function waitForImport(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const hook = window.__app as ShareHook | undefined;
    return hook !== undefined && hook.projects.length === 2;
  });
}

const SEED_BOX = [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: 'hello' }];

test('#proj-share copies a versioned share link', async ({ page }) => {
  await installCopyStub(page);
  await page.click('#proj-share');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as CopyCapture).__copied.length))
    .toBe(1);
  const [link] = await page.evaluate(() => (window as unknown as CopyCapture).__copied);
  expect(link).toMatch(/#s=1\.[A-Za-z0-9_.-]+$/);
});

test('a share link imports as a new project in a fresh browser', async ({ page }) => {
  await page.addInitScript(() => { window.prompt = () => 'Wave Rider'; });
  await page.reload();
  await page.waitForFunction(() => window.__app !== undefined);
  await page.click('#proj-rename'); // distinctive name for the payload
  await seedDoc(page, SEED_BOX, 2);
  const sent = await ascii(page);
  const url = await page.evaluate(() => (window.__app as ShareHook).shareLink());
  const imported = await openFresh(page, url);
  await waitForImport(imported);
  expect(await projectNames(imported)).toEqual(['Untitled', 'Wave Rider']);
  expect(await ascii(imported)).toBe(sent); // shared project is now current
  expect(await imported.evaluate(() => location.hash)).toBe('');
  await imported.context().close();
});

test('reloading an imported share link does not duplicate the project', async ({ page }) => {
  await seedDoc(page, SEED_BOX, 2);
  const url = await page.evaluate(() => (window.__app as ShareHook).shareLink());
  const imported = await openFresh(page, url);
  await waitForImport(imported);
  await imported.reload();
  await imported.waitForFunction(() => window.__app !== undefined);
  expect((await projectNames(imported)).length).toBe(2);
  expect((await shapes(imported)).length).toBe(1); // still on the shared doc
  await imported.context().close();
});

test('an invalid share link shows a hint and still boots the demo', async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const ctx = await page.context().browser()!.newContext();
  const opened = await ctx.newPage();
  const errors: Error[] = [];
  opened.on('pageerror', (e) => errors.push(e));
  await opened.goto(origin + '/#s=1.garbage');
  await opened.waitForFunction(() => window.__app !== undefined);
  await expect(opened.locator('#hint')).toContainText('could not be opened');
  expect(errors).toEqual([]);
  expect((await shapes(opened)).length).toBe(6); // demo booted normally
  expect(await projectNames(opened)).toEqual(['Untitled']);
  await ctx.close();
});

test('an unknown share-link version names the version problem', async ({ page }) => {
  await page.goto('/#s=9.x'); // same-document navigation → hashchange import
  await expect(page.locator('#hint')).toContainText('version');
  expect(await projectNames(page)).toEqual(['Untitled']); // nothing imported
});
