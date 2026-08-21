import type { Page } from "@playwright/test";
import type { Shape } from "../src/types";
import {
	ascii,
	copied,
	expect,
	installCopyStub,
	openFresh,
	projects,
	reloadApp,
	seedDoc,
	shapes,
	shareLink,
	stubDialogs,
	test,
	waitForProjects,
} from "./helpers";

async function projectNames(page: Page): Promise<string[]> {
	return (await projects(page)).map((p) => p.name);
}

const SEED_BOX: Shape[] = [
	{ type: "box", id: 1, x: 2, y: 2, w: 12, h: 5, text: "hello" },
];

test("#proj-share copies a versioned share link", async ({ page }) => {
	await installCopyStub(page);
	await page.click("#proj-share");
	await expect.poll(async () => (await copied(page)).length).toBe(1);
	const [link] = await copied(page);
	expect(link).toMatch(/#s=1\.[A-Za-z0-9_.-]+$/);
});

test("a share link imports as a new project in a fresh browser", async ({
	page,
}) => {
	await stubDialogs(page, { prompt: "Wave Rider" });
	await page.click("#proj-rename"); // distinctive name for the payload
	await seedDoc(page, SEED_BOX, 2);
	const sent = await ascii(page);
	const imported = await openFresh(page, await shareLink(page));
	await waitForProjects(imported, 2);
	expect(await projectNames(imported)).toEqual(["Untitled", "Wave Rider"]);
	expect(await ascii(imported)).toBe(sent); // shared project is now current
	expect(await imported.evaluate(() => location.hash)).toBe("");
	await imported.context().close();
});

test("reloading an imported share link does not duplicate the project", async ({
	page,
}) => {
	await seedDoc(page, SEED_BOX, 2);
	const imported = await openFresh(page, await shareLink(page));
	await waitForProjects(imported, 2);
	await reloadApp(imported);
	expect((await projectNames(imported)).length).toBe(2);
	expect((await shapes(imported)).length).toBe(1); // still on the shared doc
	await imported.context().close();
});

test("an invalid share link shows a hint and still boots the demo", async ({
	page,
}) => {
	const origin = new URL(page.url()).origin;
	const errors: Error[] = [];
	// The pageerror listener has to be attached before the navigation.
	const opened = await openFresh(page, origin + "/#s=1.garbage", (p) => {
		p.on("pageerror", (e) => errors.push(e));
	});
	await expect(opened.locator("#hint")).toContainText("could not be opened");
	expect(errors).toEqual([]);
	expect((await shapes(opened)).length).toBe(6); // demo booted normally
	expect(await projectNames(opened)).toEqual(["Untitled"]);
	await opened.context().close();
});

test("an unknown share-link version names the version problem", async ({
	page,
}) => {
	await page.goto("/#s=9.x"); // same-document navigation → hashchange import
	await expect(page.locator("#hint")).toContainText("version");
	expect(await projectNames(page)).toEqual(["Untitled"]); // nothing imported
});
