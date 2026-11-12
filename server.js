import express from "express";
import { Pool } from "pg";
import { rateLimit } from "express-rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));

// Для опубликованного сайта задайте CLIENT_ORIGIN равным адресу фронтенда.
const allowedOrigin = process.env.CLIENT_ORIGIN || "*";

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте позже." }
}));

if (!process.env.DATABASE_URL) {
  console.error("Нет DATABASE_URL. Подключите PostgreSQL к проекту ONREZA.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

// Время можно выбрать с точностью до минуты, пока процедура помещается в график.
// Продолжительность услуг взята из настроек учебного расписания.
const OPEN_MINUTES = 12 * 60;
const CLOSE_MINUTES = 20 * 60;
const BREAK_MINUTES = 180;

const durations = new Map([
  ["Простой маникюр", 60],
  ["Маникюр в один тон", 150],
  ["Ремонт ногтя", 60],
  ["Донаращивание ногтя", 90],
  ["Наращивание ногтя", 60]
]);

function minuteOfDay(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return NaN;
  }
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function asTime(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
}

function fitsSchedule(time, service) {
  const start = minuteOfDay(time);
  const duration = durations.get(service);
  return Number.isFinite(start) && Number.isFinite(duration) &&
    start >= OPEN_MINUTES && start + duration <= CLOSE_MINUTES;
}

function timeIsAvailable(time, service, existing) {
  if (!fitsSchedule(time, service)) return false;
  const start = minuteOfDay(time);
  const end = start + durations.get(service);

  return existing.every(row => {
    const bookedStart = minuteOfDay(row.time);
    // Для записей со старыми названиями используем безопасную длительность 2,5 часа.
    const bookedDuration = durations.get(row.service) || 150;
    const bookedEnd = bookedStart + bookedDuration;
    // Запрет пересечений и трёхчасовой интервал между процедурами.
    return start >= bookedEnd + BREAK_MINUTES ||
      bookedStart >= end + BREAK_MINUTES;
  });
}

async function bookingsForDate(db, date) {
  const result = await db.query(
    "SELECT to_char(visit_time, 'HH24:MI') AS time, service FROM bookings WHERE visit_date = $1",
    [date]
  );
  return result.rows;
}

const services = new Map([
  ["basic", "Простой маникюр"],
  ["color", "Маникюр в один тон"],
  ["repair", "Ремонт ногтя"],
  ["extension", "Донаращивание ногтя"],
  ["nails", "Наращивание ногтя"],
  ["Простой маникюр", "Простой маникюр"],
  ["Маникюр в один тон", "Маникюр в один тон"],
  ["Ремонт ногтя", "Ремонт ногтя"],
  ["Донаращивание", "Донаращивание ногтя"],
  ["Донаращивание ногтя", "Донаращивание ногтя"],
  ["Наращивание", "Наращивание ногтя"],
  ["Наращивание ногтя", "Наращивание ногтя"]
]);

function moscowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`
  };
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return false;
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) return false;
  const day = new Date(timestamp).getUTCDay();
  if (day === 0 || day === 6) return false; // Только будние дни
  const today = moscowParts().date;
  return value >= today &&
    timestamp <= Date.parse(`${today}T12:00:00Z`) + 90 * 86400000;
}

function futureSlot(date, time) {
  const now = moscowParts();
  return date > now.date || (date === now.date && time > now.time);
}

// Проверка связи с базой
app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", service: "veronika-api" });
  } catch (error) {
    next(error);
  }
});

// Подсказки свободных часов с шагом 15 минут.
// Это только подсказки: POST принимает любое HH:MM с точностью до минуты.
app.get("/api/slots", async (req, res, next) => {
  try {
    const date = req.query.date;
    const service = services.get(req.query.service || "color");
    if (!validDate(date) || !service) {
      return res.status(400).json({ error: "Укажите рабочую дату и услугу." });
    }
    const existing = await bookingsForDate(pool, date);
    const times = [];
    for (let minute = OPEN_MINUTES; minute < CLOSE_MINUTES; minute += 15) {
      const time = asTime(minute);
      if (futureSlot(date, time) && timeIsAvailable(time, service, existing)) {
        times.push(time);
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ date, times });
  } catch (error) {
    next(error);
  }
});

// Проверка произвольно выбранного часа и минуты из HTML input[type=time].
app.get("/api/availability", async (req, res, next) => {
  try {
    const { date, time } = req.query;
    const service = services.get(req.query.service);
    if (!validDate(date) || !service || !Number.isFinite(minuteOfDay(time))) {
      return res.status(400).json({ error: "Выберите дату, услугу и время." });
    }
    const existing = await bookingsForDate(pool, date);
    const available = futureSlot(date, time) && timeIsAvailable(time, service, existing);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      date, time, available,
      message: available ? "Время свободно." :
        "Этот час занят или процедура не помещается в рабочий день."
    });
  } catch (error) {
    next(error);
  }
});

// Панель мастера — HTML доступен по /admin, но список клиентов скрыт за токеном.
// ADMIN_TOKEN задаётся только в переменных окружения ONREZA, НЕ в GitHub.
app.get("/admin", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(join(currentDir, "admin.html"));
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток. Повторите позже." }
});

function authorized(req) {
  const secret = process.env.ADMIN_TOKEN;
  if (!secret || secret.length < 24) return false;

  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;

  const digest = text => createHash("sha256").update(text, "utf8").digest();
  return timingSafeEqual(digest(secret), digest(token));
}

app.get("/api/bookings", adminLimiter, async (req, res, next) => {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 24) {
    return res.status(503).json({
      error: "Просмотр записей ещё не настроен: добавьте ADMIN_TOKEN в ONREZA."
    });
  }

  if (!authorized(req)) {
    return res.status(401).json({ error: "Неверный пароль администратора." });
  }

  try {
    const result = await pool.query(
      `SELECT
          id,
          to_char(visit_date, 'YYYY-MM-DD') AS date,
          to_char(visit_time, 'HH24:MI') AS time,
          client_name AS name,
          phone,
          service
        FROM bookings
        ORDER BY visit_date DESC, visit_time DESC
        LIMIT 100`
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ bookings: result.rows });
  } catch (error) {
    next(error);
  }
});

// Транзакционная запись: блокируем выбранную дату, чтобы два человека
// одновременно не заняли пересекающееся время.
app.post("/api/bookings", async (req, res, next) => {
  let client;
  try {
    const data = req.body || {};
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    const service = services.get(data.service);
    const { date, time } = data;
    const digits = phone.replace(/\D/g, "");

    if (name.length < 2 || name.length > 80 ||
        digits.length < 10 || digits.length > 15 ||
        !service || !validDate(date) ||
        !futureSlot(date, time) || !fitsSchedule(time, service)) {
      return res.status(400).json({
        error: "Проверьте имя, телефон, услугу, дату и время работы (12:00–20:00)."
      });
    }

    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1::text))",
      [date]
    );

    const existing = await bookingsForDate(client, date);
    if (!timeIsAvailable(time, service, existing)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Время занято или между записями недостаточно перерыва."
      });
    }

    await client.query(
      "INSERT INTO bookings (visit_date, visit_time, client_name, phone, service) VALUES ($1, $2, $3, $4, $5)",
      [date, time, name, phone, service]
    );
    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "Запись успешно сохранена.",
      date,
      time
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({ error: "Это время уже занято." });
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

app.use((error, _req, res, _next) => {
  console.error("API request failed:", error.code || error.message);
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Некорректный JSON." });
  }
  res.status(500).json({ error: "Ошибка сервера. Попробуйте позже." });
});

// Таблица создаётся только если ещё не существует
async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      visit_date DATE NOT NULL,
      visit_time TIME WITHOUT TIME ZONE NOT NULL,
      client_name VARCHAR(80) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      service VARCHAR(80) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_visit_datetime UNIQUE (visit_date, visit_time)
    )
  `);

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`VERONIKA API started on ${port}`);
  });
}

start().catch(error => {
  console.error("Не удалось открыть базу данных:", error.code || error.message);
  process.exit(1);
});
