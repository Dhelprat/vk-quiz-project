import { expect, test } from '@playwright/test'

async function register(page, { fullName, email, role }) {
  await page.goto('/register')
  await page.getByLabel('ФИО / Никнейм').fill(fullName)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('password')
  await page.locator('form select').selectOption(role)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function fillSingleQuestion(page, text = 'Тестовый вопрос') {
  const question = page.locator('.question-card').first()
  await question.getByLabel('Текст вопроса').fill(text)
  await question.getByPlaceholder('Вариант ответа').nth(0).fill('Да')
  await question.getByPlaceholder('Вариант ответа').nth(1).fill('Нет')
  await question.locator('input[type="radio"]').first().check()
}

test('organizer can use defaults, duplicate and delete a quiz', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`
  await register(page, {
    fullName: 'Feature Organizer',
    email: `feature-organizer-${suffix}@example.com`,
    role: 'organizer',
  })

  await page.getByRole('link', { name: 'Создать квиз' }).click()
  await page.getByLabel('Название').fill('Управляемый квиз')
  await page.getByLabel('Категория').selectOption('Образование')
  await page.getByLabel('Время вопроса по умолчанию (сек)').fill('45')
  await fillSingleQuestion(page)
  await page.getByRole('button', { name: '+ Добавить вопрос' }).click()

  const secondQuestion = page.locator('.question-card').nth(1)
  await expect(secondQuestion.getByLabel('Таймер (сек)')).toHaveValue('45')
  await secondQuestion.getByLabel('Текст вопроса').fill('Второй вопрос')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(0).fill('Первый')
  await secondQuestion.getByPlaceholder('Вариант ответа').nth(1).fill('Второй')
  await secondQuestion.locator('input[type="radio"]').first().check()

  await page.getByRole('button', { name: 'Сохранить квиз' }).click()
  await expect(page.getByText('Квиз успешно сохранен')).toBeVisible()
  await page.goto('/dashboard')

  await page.getByRole('button', { name: 'Дублировать' }).click()
  await expect(page.getByRole('heading', { name: 'Управляемый квиз — копия' })).toBeVisible()

  const copyRow = page.locator('.quiz-row').filter({ hasText: 'Управляемый квиз — копия' })
  page.once('dialog', (dialog) => dialog.accept())
  await copyRow.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('heading', { name: 'Управляемый квиз — копия' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Управляемый квиз', exact: true })).toBeVisible()
})

test('disabled live leaderboard remains hidden until the quiz finishes', async ({ browser }) => {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`
  const organizerContext = await browser.newContext()
  const participantContext = await browser.newContext()
  const organizer = await organizerContext.newPage()
  const participant = await participantContext.newPage()

  await register(organizer, {
    fullName: 'Hidden Board Organizer',
    email: `hidden-board-organizer-${suffix}@example.com`,
    role: 'organizer',
  })
  await organizer.getByRole('link', { name: 'Создать квиз' }).click()
  await organizer.getByLabel('Название').fill('Скрытый лидерборд')
  await organizer.getByLabel('Показывать лидерборд после каждого вопроса').uncheck()
  await fillSingleQuestion(organizer, 'Когда показывать итоговый рейтинг?')
  await organizer.getByRole('button', { name: 'Сохранить квиз' }).click()
  await expect(organizer.getByText('Квиз успешно сохранен')).toBeVisible()
  await organizer.goto('/dashboard')
  await organizer.getByRole('button', { name: 'Запустить' }).click()
  await expect(organizer.getByRole('heading', { name: 'Панель ведущего' })).toBeVisible()
  const roomCode = new URL(organizer.url()).pathname.split('/').pop()

  await register(participant, {
    fullName: 'Hidden Board Player',
    email: `hidden-board-player-${suffix}@example.com`,
    role: 'participant',
  })
  await participant.goto('/join')
  await participant.getByLabel('Имя участника').fill('Hidden Board Player')
  await participant.getByLabel('Код комнаты').fill(roomCode)
  await participant.getByRole('button', { name: 'Войти в комнату' }).click()
  await expect(participant.getByRole('heading', { name: 'Лидерборд' })).toHaveCount(0)

  await organizer.getByRole('button', { name: 'Начать' }).click()
  await participant.getByRole('button', { name: 'Да' }).click()
  await participant.getByRole('button', { name: 'Отправить ответ' }).click()
  await participant.reload()
  await expect(participant.getByRole('heading', { name: 'Лидерборд' })).toHaveCount(0)

  await organizer.getByRole('button', { name: 'Завершить' }).click()
  await expect(participant.getByText('Квиз завершён')).toBeVisible()
  await expect(participant.getByRole('heading', { name: 'Лидерборд' })).toBeVisible()

  await organizerContext.close()
  await participantContext.close()
})
