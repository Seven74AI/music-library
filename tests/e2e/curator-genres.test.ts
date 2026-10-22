import { dismissOverlays, expect, test, testPrisma } from "#tests/playwright-utils.ts";

test("genre name opens library tracks for that genre", async ({
  page,
  loginAsAdmin,
  insertNewTrack,
}) => {
  test.setTimeout(60_000);
  const user = await loginAsAdmin();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const genreName = `E2E Jazz ${stamp}`;
  const emptyName = `E2E Empty ${stamp}`;
  const taggedTitle = `Tagged ${stamp}`;
  const otherTitle = `Untagged ${stamp}`;

  const genre = await testPrisma.genre.create({
    data: { name: genreName, normalizedName: genreName.toLowerCase() },
  });
  const emptyGenre = await testPrisma.genre.create({
    data: { name: emptyName, normalizedName: emptyName.toLowerCase() },
  });

  try {
    const tagged = await insertNewTrack({ title: taggedTitle }, user.id);
    await insertNewTrack({ title: otherTitle }, user.id);
    await testPrisma.track.update({
      where: { id: tagged.id },
      data: { genres: { connect: { id: genre.id } } },
    });

    await page.goto("/music/curator/genres");
    await expect(page.getByRole("heading", { name: "Genre Management" })).toBeVisible();
    await dismissOverlays(page);
    await page.getByPlaceholder("Search genres...").fill(genreName);
    await page.getByRole("link", { name: genreName }).click();

    await expect(page).toHaveURL(new RegExp(`[?&]genre=${genre.id}(?:&|$)`));
    await expect(page.getByRole("heading", { name: "Music Library" })).toBeVisible();
    await expect(page.getByText(`Showing tracks tagged with ${genreName}`)).toBeVisible();
    await expect(page.getByText(taggedTitle).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(otherTitle)).not.toBeVisible();

    await page.goto(`/library?genre=${emptyGenre.id}`);
    await expect(
      page.getByRole("heading", { name: `No tracks tagged with ${emptyName}` }),
    ).toBeVisible();
    await expect(page.getByText(taggedTitle)).not.toBeVisible();
    await expect(page.getByText(otherTitle)).not.toBeVisible();

    await page.getByRole("link", { name: "Clear filter" }).click();
    await expect(page).not.toHaveURL(/[?&]genre=/);
    await expect(page.getByText(taggedTitle).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(otherTitle).first()).toBeVisible({ timeout: 15000 });
  } finally {
    await testPrisma.genre.deleteMany({ where: { id: { in: [genre.id, emptyGenre.id] } } });
  }
});
