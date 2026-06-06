<template>
  <section class="not-found-page">
    <div class="not-found-visual" aria-hidden="true">
      <span>4</span>
      <span class="question-zero">?</span>
      <span>4</span>
    </div>

    <div class="not-found-card">
      <h1>Комната не найдена</h1>
      <p class="subtext">
        Похоже, ссылка ведет в комнату, которую никто не запускал. Вернитесь на главную и продолжите игру оттуда.
      </p>
      <RouterLink class="btn primary" to="/">На главную</RouterLink>
    </div>
  </section>
</template>
