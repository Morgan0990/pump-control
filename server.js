// ================================================================
// СЕРВЕР УПРАВЛЕНИЯ НАСОСАМИ С БАЗОЙ ДАННЫХ
// ================================================================

const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// ================================================================
// БАЗА ДАННЫХ (SQLite) - ДЛЯ ХРАНЕНИЯ ТЕМПЕРАТУРЫ
// ================================================================
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./temperatures.db');

// Создаём таблицу для температуры
db.run(`
  CREATE TABLE IF NOT EXISTS temperatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    temperature REAL,
    hour INTEGER,
    day INTEGER,
    month INTEGER,
    year INTEGER
  )
`);

// Создаём таблицу для статистики света
db.run(`
  CREATE TABLE IF NOT EXISTS voltage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_type TEXT,
    duration INTEGER,
    total_off_count INTEGER,
    total_off_time INTEGER
  )
`);

console.log('✅ База данных инициализирована');

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ================================================================
// API: ПОЛУЧИТЬ ТЕМПЕРАТУРУ ЗА МЕСЯЦ
// ================================================================
app.get('/api/temperature/month', (req, res) => {
  const month = req.query.month || new Date().getMonth() + 1;
  const year = req.query.year || new Date().getFullYear();
  
  db.all(`
    SELECT 
      date(timestamp) as date,
      AVG(temperature) as avg_temp,
      MIN(temperature) as min_temp,
      MAX(temperature) as max_temp,
      COUNT(*) as readings
    FROM temperatures
    WHERE month = ? AND year = ?
    GROUP BY date(timestamp)
    ORDER BY date(timestamp) ASC
  `, [month, year], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// ================================================================
// API: ПОЛУЧИТЬ СТАТИСТИКУ ЗА МЕСЯЦ
// ================================================================
app.get('/api/statistics/month', (req, res) => {
  const month = req.query.month || new Date().getMonth() + 1;
  const year = req.query.year || new Date().getFullYear();
  
  db.get(`
    SELECT 
      AVG(temperature) as avg_temp,
      MIN(temperature) as min_temp,
      MAX(temperature) as max_temp,
      COUNT(*) as total_readings,
      COUNT(DISTINCT date(timestamp)) as days
    FROM temperatures
    WHERE month = ? AND year = ?
  `, [month, year], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});

// ================================================================
// API: ПОСЛЕДНИЕ ПОКАЗАНИЯ
// ================================================================
app.get('/api/current', (req, res) => {
  db.get(`
    SELECT 
      temperature,
      timestamp
    FROM temperatures
    ORDER BY timestamp DESC
    LIMIT 1
  `, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row || {});
  });
});

// ================================================================
// API: СТАТИСТИКА СВЕТА
// ================================================================
app.get('/api/light/statistics', (req, res) => {
  db.get(`
    SELECT 
      SUM(CASE WHEN event_type = 'off' THEN 1 ELSE 0 END) as off_count,
      SUM(CASE WHEN event_type = 'on' THEN 1 ELSE 0 END) as on_count,
      SUM(duration) as total_off_time
    FROM voltage_events
  `, (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row || { off_count: 0, on_count: 0, total_off_time: 0 });
  });
});

// ================================================================
// WEBSOCKET - ПРИЁМ ДАННЫХ ОТ ESP32
// ================================================================
const server = app.listen(port, () => {
  console.log(`🚀 Сервер запущен на порту ${port}`);
  console.log(`🌐 http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const isEsp32 = req.url.includes('esp32');
  
  if (isEsp32) {
    console.log('✅ ESP32 подключена!');
  } else {
    console.log('✅ Сайт подключен!');
  }
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📩 Получено:', data);
      
      // Сохраняем температуру в базу данных
      if (data.temperature !== undefined && data.saveToDb === true) {
        const now = new Date();
        db.run(`
          INSERT INTO temperatures (temperature, hour, day, month, year)
          VALUES (?, ?, ?, ?, ?)
        `, [
          data.temperature,
          now.getHours(),
          now.getDate(),
          now.getMonth() + 1,
          now.getFullYear()
        ], (err) => {
          if (err) {
            console.log('❌ Ошибка сохранения температуры:', err);
          } else {
            console.log('📊 Температура сохранена в БД:', data.temperature);
          }
        });
      }
      
      // Сохраняем события света
      if (data.voltageEvent) {
        db.run(`
          INSERT INTO voltage_events (event_type, duration, total_off_count, total_off_time)
          VALUES (?, ?, ?, ?)
        `, [
          data.voltageEvent,
          data.duration || 0,
          data.totalOffCount || 0,
          data.totalOffTime || 0
        ], (err) => {
          if (err) {
            console.log('❌ Ошибка сохранения события света:', err);
          } else {
            console.log('⚡ Событие света сохранено в БД:', data.voltageEvent);
          }
        });
      }
      
    } catch (e) {
      console.log('⚠️ Ошибка обработки:', e.message);
    }
  });
  
  ws.on('close', () => {
    if (isEsp32) {
      console.log('❌ ESP32 отключена');
    } else {
      console.log('❌ Сайт отключен');
    }
  });
});