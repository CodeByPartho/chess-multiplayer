import { test, expect } from '@playwright/test'

/**
 * Static quality: legal pages render, robots/sitemap are served, and the
 * home page ships the meta/OG tags search engines and social cards need.
 */

test('privacy and terms pages render', async ({ page }) => {
  for (const [path, heading] of [
    ['/privacy', /privacy/i],
    ['/terms', /terms/i],
  ] as const) {
    await page.goto(path)
    await page.waitForSelector('.shell')
    await expect(page.locator('h1, h2').first()).toBeVisible()
    await expect(page.getByText(heading).first()).toBeVisible()
  }
})

test('robots.txt and sitemap.xml are served', async ({ page }) => {
  const robots = await page.request.get('/robots.txt')
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Sitemap:')

  const sitemap = await page.request.get('/sitemap.xml')
  expect(sitemap.ok()).toBeTruthy()
  const xml = await sitemap.text()
  expect(xml).toContain('<urlset')
  expect(xml).toContain('https://chess-multiplayer-788.netlify.app/')
})

test('home page ships title, description and social meta', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/play chess online, free/i)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /chess/i)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\//)
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', /summary/)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https:\/\//)
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/)
})
