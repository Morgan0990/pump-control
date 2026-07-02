const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let esp32Connection = null;
let webClients = [];

console.log('🚀 Запуск сервера управления насосами');
console.log('📡 Порт:', port);

const server = app.listen(port, () => {
  console.log('✅ Сервер запущен на порту', port);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const isEsp32 = req.url.includes('esp32');
  
  if (isEsp32) {
    console.log('✅ ESP32 подключена!');
    esp32Connection = ws;
    ws.send(JSON.stringify({ type: 'hello', message: 'Сервер готов' }));
  } else {
    console.log('✅ Сайт подключен!');
    webClients.push(ws);
  }
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📩 Получено:', data);
      
      if (isEsp32) {
        // Отправляем данные с ESP32 всем сайтам
        webClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      } else {
        // Отправляем команду с сайта на ESP32
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
          esp32Connection.send(JSON.stringify({
            type: 'command',
            command: data.command
          }));
          console.log('📤 Команда отправлена на ESP32:', data.command);
        }
      }
    } catch (e) {
      console.log('⚠️ Ошибка:', e.message);
    }
  });
  
  ws.on('close', () => {
    if (isEsp32) {
      console.log('❌ ESP32 отключена');
      esp32Connection = null;
    } else {
      console.log('❌ Сайт отключен');
      webClients = webClients.filter(client => client !== ws);
    }
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    esp32Connected: esp32Connection !== null,
    webClients: webClients.length
  });
});