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

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* ---------------- 업로드 ---------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.post("/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "파일 없음" });
    }

    const ext = path.extname(req.file.originalname) || ".png";
    const filename = `${Date.now()}-${uuidv4()}${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filepath, req.file.buffer);

    res.json({
      success: true,
      url: `/uploads/${filename}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "업로드 실패" });
  }
});

/* ---------------- 메모리 저장 ---------------- */

const rooms = {};

/* ---------------- socket ---------------- */

io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  socket.on("join", ({ roomId, userName, role } = {}) => {
    if (!roomId) return;

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.userName = userName || "고객";
    socket.data.role = role === "admin" ? "admin" : "user";

    if (!rooms[roomId]) {
      rooms[roomId] = {
        messages: [],
        drawings: {},
        notes: {}
      };
    }

    socket.emit("history", rooms[roomId].messages);
  });

  /* ---------- 메시지 ---------- */

  socket.on("message", ({ text } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !text) return;

    const message = {
      type: "text",
      text,
      sender: socket.data.role,
      senderName: socket.data.userName,
      time: Date.now()
    };

    const room = rooms[roomId];
    room.messages.push(message);

    io.to(roomId).emit("message", message);
  });

  /* ---------- 이미지 ---------- */

  socket.on("image", ({ url } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId || !url) return;

    const imageId = uuidv4();

    const message = {
      type: "image",
      imageId,
      imageUrl: url,
      sender: socket.data.role,
      senderName: socket.data.userName,
      time: Date.now()
    };

    const room = rooms[roomId];

    room.messages.push(message);
    room.drawings[imageId] = [];
    room.notes[imageId] = [];

    io.to(roomId).emit("image", message);
  });

  /* ---------- 드로잉 ---------- */

  socket.on("request-drawing-history", ({ imageId } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !imageId) return;

    socket.emit("drawing-history", {
      imageId,
      strokes: room.drawings[imageId] || []
    });
  });

  socket.on("draw-stroke", (payload) => {
    const room = rooms[socket.data.roomId];
    if (!room || !payload?.imageId) return;

    room.drawings[payload.imageId] =
      room.drawings[payload.imageId] || [];

    room.drawings[payload.imageId].push(payload);

    io.to(socket.data.roomId).emit("draw-stroke", payload);
  });

  socket.on("clear-drawing", ({ imageId } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !imageId) return;

    room.drawings[imageId] = [];

    io.to(socket.data.roomId).emit("clear-drawing", { imageId });
  });

  /* ---------- 노트 ---------- */

  socket.on("request-note-history", ({ imageId } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !imageId) return;

    socket.emit("note-history", {
      imageId,
      notes: room.notes[imageId] || []
    });
  });

  socket.on("add-note", ({ imageId, note } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !imageId || !note) return;

    room.notes[imageId] = room.notes[imageId] || [];
    room.notes[imageId].push(note);

    io.to(socket.data.roomId).emit("note-added", {
      imageId,
      note
    });
  });

  socket.on("clear-notes", ({ imageId } = {}) => {
    const room = rooms[socket.data.roomId];
    if (!room || !imageId) return;

    room.notes[imageId] = [];

    io.to(socket.data.roomId).emit("clear-notes", { imageId });
  });

  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
  });
});

/* ---------------- 서버 실행 ---------------- */

server.listen(PORT, HOST, () => {
  console.log("server running:", PORT);
});
