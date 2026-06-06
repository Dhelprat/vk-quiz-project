import Database from 'better-sqlite3'

import { config } from './config.js'

export const db = new Database(config.databaseFile)
db.pragma('foreign_keys = ON')
db.pragma('journal_mode = WAL')

export const DEFAULT_QUIZ_SETTINGS = {
  randomize_question_order: false,
  randomize_answer_order: false,
  show_leaderboard_after_each_question: true,
  show_correct_answers_after_question: true,
  allow_late_join: true,
  allow_answer_change: true,
  max_attempts_per_question: 1,
  points_mode: 'speed',
  countdown_seconds: 0,
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('organizer', 'participant')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      default_time_limit INTEGER NOT NULL DEFAULT 20,
      rules TEXT NOT NULL DEFAULT '',
      settings TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      image_url TEXT,
      question_type TEXT NOT NULL CHECK (question_type IN ('single', 'multiple')),
      points INTEGER NOT NULL DEFAULT 100,
      time_limit INTEGER NOT NULL DEFAULT 20
    );

    CREATE TABLE IF NOT EXISTS question_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_launches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
      current_question_index INTEGER NOT NULL DEFAULT -1,
      question_order TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL,
      active_question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
      question_started_at INTEGER,
      question_expires_at INTEGER,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS launch_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      launch_id INTEGER NOT NULL REFERENCES quiz_launches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      total_score INTEGER NOT NULL DEFAULT 0,
      answered_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE (launch_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      launch_id INTEGER NOT NULL REFERENCES quiz_launches(id) ON DELETE CASCADE,
      participant_id INTEGER NOT NULL REFERENCES launch_participants(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      selected_option_ids TEXT NOT NULL DEFAULT '[]',
      is_correct INTEGER NOT NULL DEFAULT 0,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      response_time_ms INTEGER,
      answered_at TEXT NOT NULL,
      UNIQUE (launch_id, participant_id, question_id)
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_quizzes_owner ON quizzes(owner_id);
    CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
    CREATE INDEX IF NOT EXISTS idx_options_question ON question_options(question_id);
    CREATE INDEX IF NOT EXISTS idx_launches_room ON quiz_launches(room_code);
    CREATE INDEX IF NOT EXISTS idx_participants_launch ON launch_participants(launch_id);
    CREATE INDEX IF NOT EXISTS idx_answers_launch_question ON answers(launch_id, question_id);
  `)
}

export function nowIso() {
  return new Date().toISOString()
}

export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? null)
}

export function mergeSettings(settings) {
  const incoming = typeof settings === 'string' ? parseJson(settings, {}) : settings
  const merged = { ...DEFAULT_QUIZ_SETTINGS }
  if (incoming && typeof incoming === 'object') {
    for (const key of Object.keys(merged)) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        merged[key] = incoming[key]
      }
    }
  }
  merged.max_attempts_per_question = Math.min(10, Math.max(1, Number(merged.max_attempts_per_question || 1)))
  merged.countdown_seconds = Math.min(30, Math.max(0, Number(merged.countdown_seconds || 0)))
  if (!['speed', 'accuracy', 'disabled'].includes(merged.points_mode)) merged.points_mode = 'speed'
  return merged
}

export function asBool(value) {
  return Boolean(Number(value))
}
