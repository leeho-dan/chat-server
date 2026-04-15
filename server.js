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
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});


// ==========================
// 이미지 업로드
// ==========================
const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "파일 없음" });
    }

    const ext = path.extname(req.file.originalname) || ".png";
    const filename = `${Date.now()}-${uuidv4()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filepath, req.file.buffer);

    return res.json({
      success: true,
      url: `/uploads/${filename}`
    });

  } catch (e) {
    console.error("upload error", e);
    res.status(500).json({ error: "업로드 실패" });
  }
});


// ==========================
// 메모리 저장소 (간단 안정형)
// ==========================
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      messages: []
    };
  }
  return rooms[roomId];
}


// ==========================
// 소켓 처리
// ==========================
io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  // ===== JOIN =====
  socket.on("join", (payload = {}, ack) => {
    const roomId = String(payload.roomId || "").trim();
    const role = payload.role === "admin" ? "admin" : "user";

    if (!roomId) {
      const result = { ok: false, error: "roomId 없음" };
      if (ack) ack(result);
      socket.emit("join-error", result);
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    const room = getRoom(roomId);

    // 기존 메시지 전달
    socket.emit("history", room.messages);

    const result = { ok: true, roomId };

    // 핵심: 프론트에서 기다리는 ack
    if (ack) ack(result);

    // 핵심: joined 이벤트
    socket.emit("joined", result);

    console.log("join success:", roomId);
  });


  // ===== TEXT MESSAGE =====
  socket.on("message", (payload = {}, ack) => {
    const roomId = socket.data.roomId;

    if (!roomId) {
      const result = { ok: false };
      if (ack) ack(result);
      return;
    }

    const text = String(payload.text || "").trim();
    if (!text) return;

    const message = {
      type: "text",
      text,
      sender: socket.data.role || "user",
      time: Date.now()
    };

    const room = getRoom(roomId);
    room.messages.push(message);

    io.to(roomId).emit("message", message);

    if (ack) ack({ ok: true });
  });


  // ===== IMAGE MESSAGE =====
  socket.on("image", (payload = {}, ack) => {
    const roomId = socket.data.roomId;

    if (!roomId) {
      const result = { ok: false };
      if (ack) ack(result);
      return;
    }

    const imageUrl = String(payload.url || "").trim();
    if (!imageUrl) return;

    const imageId = uuidv4();

    const message = {
      type: "image",
      imageId,
      imageUrl,
      sender: socket.data.role || "user",
      time: Date.now()
    };

    const room = getRoom(roomId);
    room.messages.push(message);

    io.to(roomId).emit("image", message);

    if (ack) {
      ack({
        ok: true,
        imageId,
        imageUrl
      });
    }
  });


  // ===== DRAW =====
  socket.on("draw-stroke", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    io.to(roomId).emit("draw-stroke", payload);
  });


  // ===== NOTE =====
  socket.on("add-note", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    io.to(roomId).emit("note-added", payload);
  });


  socket.on("update-note", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    io.to(roomId).emit("note-updated", payload);
  });


  socket.on("delete-note", (payload = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    io.to(roomId).emit("note-deleted", payload);
  });


  socket.on("disconnect", (reason) => {
    console.log("disconnect:", socket.id, reason);
  });
});


// ==========================
// 서버 시작
// ==========================
server.listen(PORT, () => {
  console.log("server running:", PORT);
});
