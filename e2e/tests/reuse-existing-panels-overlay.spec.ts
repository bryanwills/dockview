import { test, expect, Page } from '@playwright/test';

/**
 * `fromJSON(..., { reuseExistingPanels: true })` with `always`-rendered panels.
 *
 * Reused panels keep their overlay element across the rebuild, and an overlay
 * is positioned from a measured `getBoundingClientRect()`. jsdom reports 0x0
 * for every element and never lays anything out, so the unit tests have to mock
 * those rects — which means they assert what we *believe* the geometry to be.
 * These specs assert what a browser actually paints.
 *
 * The interesting states are transient (a frame or two), so each spec samples
 * per-frame across the rebuild rather than using polling assertions, which
 * would only ever observe the settled layout.
 */
test.describe('reuseExistingPanels overlay geometry', () => {
    const ready = async (page: Page) => {
        await page.goto('/e2e/fixtures/index.html');
        await page.waitForFunction(() => (window as any).__ready === true);
    };

    const snapshot = (page: Page) =>
        page.evaluate(() => JSON.stringify((window as any).__dv.snapshot()));

    const sample = (page: Page, id: string, frames = 6) =>
        page.evaluate(
            ([panelId, count]) =>
                (window as any).__dv.sampleOverlayRects(panelId, count),
            [id, frames] as const
        );

    /**
     * An overlay attached twice before any positioning frame has run has no
     * geometry of its own. Revealing it in that state lets
     * `.dv-render-overlay`'s `width:100%;height:100%` default take over and the
     * panel covers the entire render container.
     *
     * This is the spec that fails on the unfixed engine — the overlay is
     * sampled at the full 1280x~700 container size instead of its group's half.
     */
    test('an overlay attached twice before its first positioning frame is not revealed unpositioned', async ({
        page,
    }) => {
        await ready(page);
        await page.evaluate(() => (window as any).__dv.setupReuseAlways());

        // `addPanel` + `fromJSON(reuse)` in a single tick.
        const [samples] = await Promise.all([
            sample(page, 'fresh'),
            page.evaluate(() =>
                (window as any).__dv.addAlwaysThenReuseSameTick('fresh')
            ),
        ]);

        expect(samples.length).toBeGreaterThan(0);

        for (const s of samples) {
            if (s.visibility === 'hidden') {
                continue; // not painted, so its geometry cannot be seen
            }
            // Painted means positioned: it must not span the container. The
            // width bound is the decisive one — 'fresh' joins one half of a
            // left/right split, so an unpositioned overlay reads as the full
            // container width. A height bound would only be measuring the tab
            // header, which is styling-dependent and too tight to assert on.
            expect(s.width).toBeLessThan(s.parentWidth * 0.9);
        }
    });

    /**
     * Regression guard rather than a reproduction: an identical-layout restore
     * retains geometry that is still correct, so this passes on the unfixed
     * engine too. It pins the invariant that a reused overlay is never painted
     * at container size at any point during a rebuild.
     */
    test('a reused overlay never covers the whole render container', async ({
        page,
    }) => {
        await ready(page);
        await page.evaluate(() => (window as any).__dv.setupReuseAlways());

        const state = await snapshot(page);

        const [samples] = await Promise.all([
            sample(page, 'left'),
            page.evaluate(
                (s) => (window as any).__dv.restoreReuse(JSON.parse(s)),
                state
            ),
        ]);

        expect(samples.length).toBeGreaterThan(0);

        // Two panels split left/right, so a correctly positioned overlay is
        // about half the container.
        for (const s of samples) {
            if (s.visibility === 'hidden') {
                continue;
            }
            expect(s.width).toBeLessThan(s.parentWidth * 0.9);
        }
    });

    /**
     * Restoring a layout that *moves* a reused panel carries geometry that is
     * now wrong, so the overlay is briefly painted at its pre-rebuild position
     * before the reposition lands. That brief stale paint is intended — the
     * alternative is blanking the panel for the whole rebuild.
     *
     * What must hold is that the window is *bounded* and the overlay ends up
     * over its own group. Measured here: the stale paint lasts two frames on
     * the unfixed engine and usually one once the superseded `attach` can no
     * longer swallow the reposition — but not reliably enough to assert an
     * exact frame count without flaking, so this asserts the bound instead.
     */
    test('a reused overlay settles over its own group when the layout moves it', async ({
        page,
    }) => {
        await ready(page);
        await page.evaluate(() => (window as any).__dv.setupReuseAlways());

        const state = await snapshot(page);

        // Move 'left' over to the right-hand side, then restore the snapshot
        // that puts it back.
        await page.evaluate(() => (window as any).__dv.swapReuseAlways());
        await page.waitForTimeout(100);

        const [samples] = await Promise.all([
            sample(page, 'left', 8),
            page.evaluate(
                (s) => (window as any).__dv.restoreReuse(JSON.parse(s)),
                state
            ),
        ]);

        const isCorrect = (s: any) =>
            s.visibility !== 'hidden' && s.left < s.parentWidth * 0.5;

        const firstCorrect = samples.findIndex(isCorrect);
        expect(firstCorrect).toBeGreaterThanOrEqual(0);
        expect(firstCorrect).toBeLessThanOrEqual(3);

        // ...and having settled, it stays put rather than oscillating.
        for (const s of samples.slice(firstCorrect)) {
            expect(isCorrect(s)).toBe(true);
            expect(s.width).toBeLessThan(s.parentWidth * 0.9);
        }
    });
});
