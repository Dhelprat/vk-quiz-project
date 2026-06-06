import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const screenshotsDir = path.resolve(process.cwd(), '../docs/qa-screenshots')

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

test('organizer creates and hosts a live quiz, participant joins and answers', async ({ browser, baseURL }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`
  const organizerContext = await browser.newContext()
  const playerContext = await browser.newContext()
  const organizerPage = await organizerContext.newPage()
  const playerPage = await playerContext.newPage()

  await register(organizerPage, {
    fullName: 'E2E Organizer',
    email: `e2e-organizer-${suffix}@example.com`,
    role: 'organizer',
  })

  await organizerPage.getByRole('link', { name: 'Создать квиз' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Создание квиза' })).toBeVisible()

  await organizerPage.getByLabel('Название').fill('E2E live quiz')
  await organizerPage.getByLabel('Категория').fill('QA')
  await organizerPage.getByLabel('Описание').fill('Проверка полного пользовательского сценария')
  await organizerPage.getByLabel('Правила').fill('Ответить до окончания таймера')

  const firstQuestion = organizerPage.locator('.question-card').nth(0)
  await firstQuestion.getByLabel('Текст вопроса').fill('Что используется для realtime-взаимодействия?')
  await firstQuestion.getByPlaceholder('Вариант ответа').nth(0).fill('Socket.IO')
  await firstQuestion.getByPlaceholder('Вариант ответа').nth(1).fill('Email')
  await firstQuestion.locator('input[type="radio"]').nth(0).check()

  await organizerPage.getByRole('button', { name: '+ Добавить вопрос' }).click()
  const secondQuestion = organizerPage.locator('.question-card').nth(1)
  await secondQuestion.getByLabel('Текст вопроса').fill('Какие экраны важны для организатора?')
  await secondQuestion.getByLabel('Тип ответа').selectOption('multiple')
  await secondQuestion.getByRole('button', { name: '+ Добавить вариант' }).click()
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(0).fill('Live-панель')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(1).fill('Режим администратора')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(2).fill('Просмотр чужих данных')
  await secondQuestion.locator('input[type="checkbox"]').nth(0).check()
  await secondQuestion.locator('input[type="checkbox"]').nth(1).check()

  await organizerPage.getByRole('button', { name: 'Сохранить квиз' }).click()
  await expect(organizerPage.getByText('Квиз успешно сохранен')).toBeVisible()
  await expect(organizerPage).toHaveURL(/\/quiz-builder\/\d+$/)

  await organizerPage.goto('/dashboard')
  await organizerPage.getByRole('button', { name: 'Запустить' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Панель ведущего' })).toBeVisible()
  const roomCode = new URL(organizerPage.url()).pathname.split('/').pop()
  expect(roomCode).toMatch(/^[A-Z0-9]{8}$/)
  await saveScreenshot(organizerPage, '01-host-room.png')

  await register(playerPage, {
    fullName: 'E2E Player',
    email: `e2e-player-${suffix}@example.com`,
    role: 'participant',
  })
  await playerPage.goto('/join')
  await playerPage.getByLabel('Имя участника').fill('E2E Player')
  await playerPage.getByLabel('Код комнаты').fill(roomCode)
  await playerPage.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Комната участника' })).toBeVisible()
  await expect(playerPage.getByRole('heading', { name: 'Вы в комнате ожидания' })).toBeVisible()
  await expect(organizerPage.getByRole('heading', { name: 'Экран ожидания участников' })).toBeVisible()
  await expect(organizerPage.getByText('E2E Player')).toBeVisible()

  await organizerPage.getByRole('button', { name: 'Начать' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Что используется для realtime-взаимодействия?' })).toBeVisible()
  await expect(playerPage.getByRole('heading', { name: 'Игроки отвечают' })).toBeVisible()
  await expect(organizerPage.getByRole('heading', { name: 'Прогресс ответов' })).toBeVisible()
  await playerPage.getByRole('button', { name: 'Socket.IO' }).click()
  await playerPage.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(playerPage.getByText('Ответ принят')).toBeVisible()
  await expect(organizerPage.locator('.answer-progress-card').getByText('1/1')).toBeVisible()
  await saveScreenshot(playerPage, '02-player-answer.png')

  await organizerPage.getByRole('button', { name: 'Следующий вопрос' }).click()
  await expect(playerPage.getByRole('heading', { name: 'Какие экраны важны для организатора?' })).toBeVisible()
  await playerPage.getByRole('button', { name: 'Live-панель' }).click()
  await playerPage.getByRole('button', { name: 'Режим администратора' }).click()
  await playerPage.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(playerPage.getByText('Ответ принят')).toBeVisible()

  await organizerPage.getByRole('button', { name: 'Завершить' }).click()
  await expect(playerPage.getByText('Квиз завершён')).toBeVisible()
  await expect(playerPage.getByText('E2E Player')).toBeVisible()

  await organizerPage.getByRole('button', { name: 'Режим администратора' }).click()
  await expect(organizerPage.getByRole('heading', { name: 'Сводка по сессии' })).toBeVisible()
  await expect(organizerPage.getByRole('heading', { name: 'График точности по вопросам' })).toBeVisible()
  await expect(organizerPage.getByRole('heading', { name: 'Распределение ответов' })).toBeVisible()
  await expect(organizerPage.getByRole('heading', { name: 'Прогресс участников' })).toBeVisible()
  await expect(organizerPage.locator('.kpi-card').filter({ hasText: 'Участников' })).toContainText('1')
  await expect(organizerPage.locator('.kpi-card').filter({ hasText: 'Средняя точность' })).toContainText('100%')
  const downloadPromise = organizerPage.waitForEvent('download')
  await organizerPage.getByRole('button', { name: 'Экспорт результатов' }).click()
  const download = await downloadPromise
  const csvPath = await download.path()
  const csvText = await fs.readFile(csvPath, 'utf8')
  expect(csvText).toContain('E2E Player')
  expect(csvText).toContain('E2E live quiz')
  await saveScreenshot(organizerPage, '03-admin-analytics.png')

  await organizerContext.close()
  await playerContext.close()
})
