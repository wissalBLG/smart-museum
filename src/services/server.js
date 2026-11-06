import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// معلومات الاتصال بـ Supabase
const SUPABASE_URL = 'https://lteoivkoexhgbtufmlcw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_**************************';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// دالة تطبيع المعرف للمطابقة التامة
function normalizeIdentifier(identifier) {
  return typeof identifier === "string"
    ? identifier.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    : "";
}
// جلب جميع القطع الأثرية من Supabase للواجهة الأمامية
app.get('/api/artifacts', async (req, res) => {
  try {
    const { data, error } = await supabase.from('artifacts').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error fetching artifacts:', err);
    res.status(500).json({ error: 'Failed to fetch artifacts' });
  }
});
// نقطة استقبال الـ RFID لاسلكياً من الـ ESP32-S3
// داخل ملف الـ server.js الخاص بك (على البورت 3000)
app.post('/api/rfid', async (req, res) => {
  const { uid } = req.body;
  
  // البحث في Supabase
  const { data: artifact, error } = await supabase
    .from('artifacts')
    .select('*')
    .eq('card_uid', uid)
    .single();

  if (error || !artifact) {
    return res.status(404).json({ error: "Artifact not found" });
  }

  // الرد على لوحة الـ ESP32
  res.json({ status: "Success", artifact });

  // ⭐ السطر الأهم لإرسال الحدث للواجهة عبر Socket.io:
  io.emit('rfid_scanned', artifact);
  console.log("Emitted rfid_scanned for:", artifact.name);
});
app.get('/', (req, res) => {
  res.send('Smart Museum Backend is Running!');
});
server.listen(3000, () => {

  console.log('Bridge Server running on http://localhost:3000');
  console.log('Artifacts API: http://localhost:3000/api/artifacts');
});
