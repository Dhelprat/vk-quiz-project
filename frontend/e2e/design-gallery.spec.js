import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const galleryDir = path.resolve(process.cwd(), '../docs/design-gallery')

async function screenshot(page, name) {
  await fs.mkdir(galleryDir, { recursive: true })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(350)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(galleryDir, name), fullPage: true })
}

async function register(page, { fullName, email, role }) {
  await page.goto('/register')
  await page.getByLabel('ФИО / Никнейм').fill(fullName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('password')
  await page.locator('form select').selectOption(role)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function createDemoQuiz(page) {
  await page.goto('/quiz-builder/new')
  await page.getByLabel('Название').fill('Демо-квиз для защиты')
  await page.getByLabel('Категория').selectOption('Образование')
  await page.getByLabel('Описание').fill('Проверка дизайна и полного сценария')
  await page.getByLabel('Правила').fill('Отвечайте во время показа вопроса')

  const firstQuestion = page.locator('.question-card').nth(0)
  await firstQuestion.getByLabel('Текст вопроса').fill('Как участник видит результат после ответа?')
  await firstQuestion.getByPlaceholder('Вариант ответа').nth(0).fill('Через баллы и лидерборд')
  await firstQuestion.getByPlaceholder('Вариант ответа').nth(1).fill('Только в отдельном чате')
  await firstQuestion.locator('input[type="radio"]').nth(0).check()

  await page.getByRole('button', { name: '+ Добавить вопрос' }).click()
  const secondQuestion = page.locator('.question-card').nth(1)
  await secondQuestion.getByLabel('Текст вопроса').fill('Какие функции есть у организатора?')
  await secondQuestion.getByLabel('Тип ответа').selectOption('multiple')
  await secondQuestion.getByRole('button', { name: '+ Добавить вариант' }).click()
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(0).fill('Запуск комнаты')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(1).fill('Админ-аналитика')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(2).fill('Просмотр чужих паролей')
  await secondQuestion.locator('input[type="checkbox"]').nth(0).check()
  await secondQuestion.locator('input[type="checkbox"]').nth(1).check()

  await screenshot(page, '05-builder-filled.png')
  await page.getByRole('button', { name: 'Сохранить квиз' }).click()
  await expect(page.getByText('Квиз успешно сохранен')).toBeVisible()
  return new URL(page.url()).pathname.split('/').pop()
}

test('capture all main design pages', async ({ browser }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`
  const organizerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const organizerPage = await organizerContext.newPage()
  const playerPage = await playerContext.newPage()

  await organizerPage.goto('/')
  await screenshot(organizerPage, '01-home.png')

  await organizerPage.goto('/register')
  await screenshot(organizerPage, '02-register.png')

  await organizerPage.goto('/login')
  await screenshot(organizerPage, '03-login.png')

  await register(organizerPage, {
    fullName: 'Gallery Organizer',
    email: `gallery-organizer-${suffix}@example.com`,
    role: 'organizer',
  })
  await screenshot(organizerPage, '04-organizer-dashboard-empty.png')

  await createDemoQuiz(organizerPage)
  await organizerPage.goto('/dashboard')
  await screenshot(organizerPage, '06-organizer-dashboard-with-quiz.png')
  await organizerPage.getByRole('button', { name: 'Запустить' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Панель ведущего' })).toBeVisible()
  const roomCode = new URL(organizerPage.url()).pathname.split('/').pop()
  await screenshot(organizerPage, '07-host-waiting.png')

  await register(playerPage, {
    fullName: 'Gallery Player',
    email: `gallery-player-${suffix}@example.com`,
    role: 'participant',
  })
  await playerPage.goto('/join')
  await screenshot(playerPage, '08-join.png')
  await playerPage.getByLabel('Имя участника').fill('Gallery Player')
  await playerPage.getByLabel('Код комнаты').fill(roomCode)
  await playerPage.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Комната участника' })).toBeVisible()
  await screenshot(playerPage, '09-player-waiting.png')

  await organizerPage.getByRole('button', { name: 'Начать' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Как участник видит результат после ответа?' })).toBeVisible()
  await playerPage.getByRole('button', { name: 'Через баллы и лидерборд' }).click()
  await playerPage.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(playerPage.getByText('Ответ принят')).toBeVisible()
  await screenshot(playerPage, '10-player-question-answered.png')

  await organizerPage.getByRole('button', { name: 'Следующий вопрос' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Какие функции есть у организатора?' })).toBeVisible()
  await playerPage.getByRole('button', { name: 'Запуск комнаты' }).click()
  await playerPage.getByRole('button', { name: 'Админ-аналитика' }).click()
  await playerPage.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(playerPage.getByText('Ответ принят')).toBeVisible()
  await organizerPage.getByRole('button', { name: 'Завершить' }).click()
  await expect(playerPage.getByText('Квиз завершён')).toBeVisible()
  await screenshot(playerPage, '11-player-finished.png')

  await organizerPage.getByRole('button', { name: 'Режим администратора' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Сводка по сессии' })).toBeVisible()
  await screenshot(organizerPage, '12-host-admin-analytics.png')

  await playerPage.goto('/dashboard')
  await screenshot(playerPage, '13-participant-dashboard.png')

  await organizerPage.goto('/unknown-page')
  await screenshot(organizerPage, '14-not-found.png')

  await organizerContext.close()
  await playerContext.close()
})
