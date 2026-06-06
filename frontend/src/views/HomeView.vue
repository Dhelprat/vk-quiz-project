<template>
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">Live quiz arena</p>
        <h1>
          <span class="hero-title-main">QuizHub</span>
          <span class="hero-title-accent">играет вместе с залом</span>
        </h1>
        <p class="hero-lead">
          Яркая платформа для школьных занятий, студенческих игр и корпоративных событий:
          создавайте квизы, запускайте live-комнаты, начисляйте очки и показывайте победителей.
        </p>

        <div class="hero-actions">
          <RouterLink class="btn accent" to="/quiz-builder/new">Создать квиз</RouterLink>
          <RouterLink class="btn ghost" to="/join">Присоединиться</RouterLink>
        </div>

        <div class="hero-metrics" aria-label="Преимущества платформы">
          <div><strong>Live</strong><span>ответы без задержки</span></div>
          <div><strong>100%</strong><span>фокус на вопросе</span></div>
          <div><strong>TOP 3</strong><span>призовые места</span></div>
        </div>
      </div>

      <div class="hero-visual" aria-hidden="true">
        <div class="arena-board">
          <div class="arena-top">
            <span>Комната J2ME5SQR</span>
            <strong>20 c</strong>
          </div>
          <div class="arena-question">Что дает больше очков?</div>
          <div class="arena-options">
            <span class="selected">Быстрый правильный ответ</span>
            <span>Случайный клик</span>
            <span>Поздний вход</span>
          </div>
          <div class="arena-score">
            <div><span>1</span><strong>Карина</strong><em>240</em></div>
            <div><span>2</span><strong>Команда VK</strong><em>210</em></div>
            <div><span>3</span><strong>Гости</strong><em>180</em></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="features">
    <div class="container">
      <p class="eyebrow center">Возможности</p>
      <h2>От идеи вопроса до пьедестала</h2>
      <p class="section-subtitle">Все ключевые инструменты для подготовки, проведения и анализа интерактивного квиза.</p>

      <div class="feature-grid">
        <article class="feature-card pink">
          <div class="feature-icon">01</div>
          <h3>Конструктор</h3>
          <p>Вопросы с одиночным и множественным выбором, изображениями, таймером и баллами.</p>
        </article>
        <article class="feature-card green">
          <div class="feature-icon dark">02</div>
          <h3>Live-режим</h3>
          <p>Участники входят по коду комнаты и видят вопрос одновременно с ведущим.</p>
        </article>
        <article class="feature-card pink">
          <div class="feature-icon">03</div>
          <h3>Лидерборд</h3>
          <p>Баллы пересчитываются после вопроса и показываются всем участникам.</p>
        </article>
        <article class="feature-card green">
          <div class="feature-icon dark">04</div>
          <h3>Аналитика</h3>
          <p>Организатор видит сводку сессии, лидерборд и прогресс каждого участника.</p>
        </article>
        <article class="feature-card pink">
          <div class="feature-icon">05</div>
          <h3>Настройки</h3>
          <p>Перемешивание, попытки, поздний вход, показ ответов и разные режимы начисления очков.</p>
        </article>
        <article class="feature-card green">
          <div class="feature-icon dark">06</div>
          <h3>История</h3>
          <p>Личный кабинет сохраняет проведенные и пройденные квизы.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="how">
    <div class="container">
      <p class="eyebrow center">Сценарии</p>
      <h2>Подходит для разных аудиторий</h2>
      <div class="how-grid">
        <div class="how-column">
          <h3><span class="step-dot">1</span> Школы</h3>
          <ul>
            <li>Проверка знаний без скучных тестов.</li>
            <li>Понятный вход по коду для класса.</li>
            <li>Спокойный экран ответа без лишней анимации.</li>
            <li>Результаты для обсуждения после занятия.</li>
          </ul>
        </div>
        <div class="how-column">
          <h3><span class="step-dot green">2</span> Университеты</h3>
          <ul>
            <li>Быстрые опросы на парах и семинарах.</li>
            <li>Командные активности и соревнования.</li>
            <li>Настройки времени, попыток и баллов.</li>
            <li>История участия и итоговые очки.</li>
          </ul>
        </div>
        <div class="how-column wide">
          <h3><span class="step-dot pink">3</span> Корпоративные события</h3>
          <ul>
            <li>Live-квизы для тимбилдинга, митапов и внутренних мероприятий.</li>
            <li>Лидерборд с призовыми местами и аналитика по вовлеченности участников.</li>
            <li>Админ-панель для контроля прогресса и завершения игры в нужный момент.</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="cta">
    <div class="container cta-box">
      <h2>Ну что, приступим?</h2>
      <p>Создай свой первый квиз прямо сейчас и пригласи друзей.</p>
      <RouterLink class="btn success wide" to="/quiz-builder/new">Создать квиз!</RouterLink>
    </div>
  </section>
</template>
