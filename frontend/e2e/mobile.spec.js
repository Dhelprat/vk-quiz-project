import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const screenshotsDir = path.resolve(process.cwd(), '../docs/mobile-qa')
const mobileViewport = { width: 390, height: 844 }

async function register(page, { fullName, email, role }) {
  await page.goto('/register')
  await page.getByLabel('ФИО / Никнейм').fill(fullName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('password')
  await page.locator('form select').selectOption(role)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function saveScreenshot(page, name) {
  await fs.mkdir(screenshotsDir, { recursive: true })
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: true })
}

async function assertMobileLayout(page, label) {
  await page.waitForLoadState('networkidle')
  const result = await page.evaluate(() => {
    const root = document.documentElement
    const interactiveSelector = 'button, a, input, select, textarea'
    const boundedSelector = [
      '.kpi-card',
      '.feature-card',
      '.quick-card',
      '.question-card',
      '.answer-progress-card',
      '.live-head',
      '.auth-card',
      '.join-card',
    ].join(',')

    const visible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const outsideViewport = [...document.querySelectorAll(interactiveSelector)]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left < -1 || rect.right > window.innerWidth + 1
      })
      .map((element) => ({
        tag: element.tagName,
        text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 80),
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }))

    const overflowingBlocks = [...document.querySelectorAll(boundedSelector)]
      .filter(visible)
      .filter((element) => {
        const style = window.getComputedStyle(element)
        return style.overflowX !== 'auto' && style.overflowX !== 'scroll' && element.scrollWidth > element.clientWidth + 2
      })
      .map((element) => ({
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))

    return {
      viewportWidth: window.innerWidth,
      documentClientWidth: root.clientWidth,
      documentScrollWidth: root.scrollWidth,
      outsideViewport,
      overflowingBlocks,
    }
  })

  expect(
    result.documentScrollWidth,
    `${label}: document width ${result.documentScrollWidth}px exceeds viewport ${result.documentClientWidth}px`,
  ).toBeLessThanOrEqual(result.documentClientWidth + 1)
  expect(result.outsideViewport, `${label}: interactive elements outside viewport`).toEqual([])
  expect(result.overflowingBlocks, `${label}: card content overflows its container`).toEqual([])
}

test('public pages remain usable at narrow phone widths', async ({ browser }) => {
  for (const viewport of [{ width: 360, height: 800 }, mobileViewport]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()

    for (const route of ['/', '/register', '/login', '/join', '/unknown-page']) {
      await page.goto(route)
      await assertMobileLayout(page, `${viewport.width}px ${route}`)
    }

    await context.close()
  }
})

test('complete quiz flow is responsive on a phone', async ({ browser }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`
  const organizerContext = await browser.newContext({ viewport: mobileViewport })
  const playerContext = await browser.newContext({ viewport: mobileViewport })
  const organizerPage = await organizerContext.newPage()
  const playerPage = await playerContext.newPage()

  await register(organizerPage, {
    fullName: 'Mobile Organizer',
    email: `mobile-organizer-${suffix}@example.com`,
    role: 'organizer',
  })
  await assertMobileLayout(organizerPage, 'organizer dashboard')

  await organizerPage.getByRole('link', { name: 'Создать квиз' }).click()
  await organizerPage.getByLabel('Название').fill('Mobile QA quiz')
  await organizerPage.getByLabel('Категория').fill('Mobile QA')
  await organizerPage.getByLabel('Описание').fill('Проверка адаптивности полного сценария')
  await organizerPage.getByLabel('Правила').fill('Ответить во время показа вопроса')

  const question = organizerPage.locator('.question-card').first()
  await question.getByLabel('Текст вопроса').fill('Адаптируется ли интерфейс к телефону?')
  await question.getByPlaceholder('Вариант ответа').nth(0).fill('Да')
  await question.getByPlaceholder('Вариант ответа').nth(1).fill('Нет')
  await question.locator('input[type="radio"]').first().check()
  await assertMobileLayout(organizerPage, 'quiz builder')

  await organizerPage.getByRole('button', { name: 'Сохранить квиз' }).click()
  await expect(organizerPage.getByText('Квиз успешно сохранен')).toBeVisible()
  await organizerPage.goto('/dashboard')
  await organizerPage.getByRole('button', { name: 'Запустить' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Панель ведущего' })).toBeVisible()
  const roomCode = new URL(organizerPage.url()).pathname.split('/').pop()
  await assertMobileLayout(organizerPage, 'host waiting room')
  await saveScreenshot(organizerPage, '01-host-mobile.png')

  await register(playerPage, {
    fullName: 'Mobile Player',
    email: `mobile-player-${suffix}@example.com`,
    role: 'participant',
  })
  await assertMobileLayout(playerPage, 'participant dashboard')
  await playerPage.goto('/join')
  await playerPage.getByLabel('Имя участника').fill('Mobile Player')
  await playerPage.getByLabel('Код комнаты').fill(roomCode)
  await assertMobileLayout(playerPage, 'join form')
  await playerPage.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Вы в комнате ожидания' })).toBeVisible()
  await assertMobileLayout(playerPage, 'participant waiting room')

  await organizerPage.getByRole('button', { name: 'Начать' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Адаптируется ли интерфейс к телефону?' })).toBeVisible()
  await assertMobileLayout(playerPage, 'active mobile question')
  await playerPage.getByRole('button', { name: 'Да' }).click()
  await playerPage.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(playerPage.getByText('Ответ принят')).toBeVisible()
  await saveScreenshot(playerPage, '02-player-mobile.png')

  await organizerPage.getByRole('button', { name: 'Завершить' }).click()
  await expect(playerPage.getByText('Квиз завершён')).toBeVisible()
  await assertMobileLayout(playerPage, 'mobile leaderboard')

  await organizerPage.getByRole('button', { name: 'Режим администратора' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Сводка по сессии' })).toBeVisible()
  await expect(organizerPage.locator('.kpi-card').filter({ hasText: 'Средний темп (мс)' })).toBeVisible()
  await assertMobileLayout(organizerPage, 'mobile admin analytics')
  await saveScreenshot(organizerPage, '03-admin-mobile.png')

  await playerPage.goto('/dashboard')
  await assertMobileLayout(playerPage, 'participant history')
  await organizerPage.goto('/unknown-page')
  await assertMobileLayout(organizerPage, 'mobile 404')

  await organizerContext.close()
  await playerContext.close()
})
