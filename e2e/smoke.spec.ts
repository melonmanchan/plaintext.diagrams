import { ascii, canvasRect, cellPx, drag, expect, test } from './helpers';

test('boots the demo doc and draws a box with the mouse', async ({ page }) => {
  const c = await canvasRect(page);
  await page.keyboard.press('b');                       // box tool
  await drag(page, cellPx(c, 2, 2), cellPx(c, 13, 4));  // 12x3 box
  await page.keyboard.press('Escape');
  expect(await ascii(page)).toBe([
    '    GET /index.html',
    '┌──────────┐',
    '│          │                          ┌────────────────┐',
    '└──────────┴───────┐                  │                │',
    '    │              │                  │      Web       │',
    '    │   Browser    │─────────────────▶│     Server     │',
    '    │              │                  │                │',
    '    └──────────────┘                  │                │',
    '                                      └────────────────┘',
    '                                               │',
    '                                               │',
    '                                               │',
    '                                               │',
    '                                               │',
    '                                               ▼',
    '                                       ┌──────────────┐',
    '                                       │              │',
    '                                       │   Database   │',
    '                                       │              │',
    '                                       └──────────────┘',
  ].join('\n'));
});
