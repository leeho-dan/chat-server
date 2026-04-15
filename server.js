const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// 요청 로그 (디버깅용)
app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.url);
  next();
});

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ================= 업로드 =================
const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "파일 없음" });

    const ext = path.extname(req.file.originalname) || ".png";
    const filename = `${Date.now()}-${uuidv4()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filepath, req.file.buffer);

    res.json({
      success: true,
      url: `/uploads/${filename}`
    });
  } catch (e) {
    console.error("upload error", e);
    res.status(500).json({ error: "업로드 실패" });
  }
});

// ================= 메모리 =================
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      messages: [],
      drawings: {},
      notes: {}
    };
  }
  return rooms[roomId];
}

// ================= 소켓 =================
io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  socket.on("join", (payload = {}, ack) => {
    try {
      const roomId = String(payload.roomId || "").trim();
      if (!roomId) return;

      socket.join(roomId);
      socket.data.roomId = roomId;

      const room = getRoom(roomId);

      socket.emit("history", room.messages);

      if (ack) ack({ ok: true });
      socket.emit("joined", { ok: true });

    } catch (e) {
      console.error("join error", e);
    }
  });

  socket.on("message", (payload = {}, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const message = {
      type: "text",
      text: payload.text,
      time: Date.now()
    };

    const room = getRoom(roomId);
    room.messages.push(message);

    io.to(roomId).emit("message", message);

    if (ack) ack({ ok: true });
  });

  socket.on("image", (payload = {}, ack) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const imageId = uuidv4();

    const message = {
      type: "image",
      imageId,
      imageUrl: payload.url,
      time: Date.now()
    };

    const room = getRoom(roomId);
    room.messages.push(message);

    io.to(roomId).emit("image", message);

    if (ack) ack({ ok: true, imageId });
  });

  socket.on("draw-stroke", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit("draw-stroke", data);
  });

  socket.on("add-note", (data) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit("note-added", data);
  });

  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
  });
});

// ===== 502 방어 =====
process.on("uncaughtException", (err) => {
  console.error("uncaught:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("unhandled:", err);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 121000;

// ===== 서버 시작 =====
server.listen(PORT, HOST, () => {
  console.log("server running:", PORT);
});
