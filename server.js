require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const cloudinary = require("cloudinary").v2;

const app = express();
const server = http.createServer(app);

/* =========================
   ENV 설정
========================= */
const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = process.env.MONGODB_DB_NAME || "design-chat";

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

/* =========================
   기본 설정
========================= */
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

/* =========================
   MongoDB 연결
========================= */
let isMongoConnected = false;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, { dbName: DB_NAME })
    .then(() => {
      console.log("MongoDB 연결 성공");
      isMongoConnected = true;
    })
    .catch((err) => {
      console.error("MongoDB 연결 실패 → 메모리 모드 사용", err.message);
    });
}

/* =========================
   메모리 저장소 (fallback)
========================= */
const memoryDB = {
  messages: {},
  drawings: {},
  notes: {},
};

/* =========================
   Socket.io
========================= */
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

/* =========================
   CONFIG API
========================= */
app.get("/config", (req, res) => {
  res.json({
    ok: true,
    version: "3.1.0",
    socketPath: "/socket.io",
  });
});

/* =========================
   이미지 업로드
========================= */
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "파일 없음" });
    }

    const result = await cloudinary.uploader.upload_stream(
      { folder: "design-chat" },
      (error, result) => {
        if (error) {
          return res.status(500).json({ ok: false, error: "업로드 실패" });
        }
        return res.json({ ok: true, url: result.secure_url });
      }
    );

    result.end(req.file.buffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================
   Socket 이벤트
========================= */
io.on("connection", (socket) => {
  let currentRoom = null;

  socket.on("join", ({ roomId, userName, role }, callback) => {
    currentRoom = roomId;
    socket.join(roomId);

    if (!memoryDB.messages[roomId]) {
      memoryDB.messages[roomId] = [];
    }

    socket.emit("history", {
      messages: memoryDB.messages[roomId],
    });

    callback && callback({ ok: true });
  });

  socket.on("message", ({ text }, callback) => {
    if (!currentRoom) return;

    const msg = {
      id: uuidv4(),
      type: "text",
      text,
      sender: "user",
      senderName: "고객",
      time: Date.now(),
    };

    memoryDB.messages[currentRoom].push(msg);

    io.to(currentRoom).emit("message", msg);

    callback && callback({ ok: true });
  });

  socket.on("image", ({ url }, callback) => {
    if (!currentRoom) return;

    const msg = {
      id: uuidv4(),
      type: "image",
      imageUrl: url,
      imageId: uuidv4(),
      sender: "user",
      senderName: "고객",
      time: Date.now(),
    };

    memoryDB.messages[currentRoom].push(msg);

    io.to(currentRoom).emit("message", msg);

    callback && callback({ ok: true });
  });

  /* =========================
     드로잉
  ========================= */
  socket.on("draw-stroke", ({ imageId, stroke }) => {
    if (!memoryDB.drawings[imageId]) {
      memoryDB.drawings[imageId] = [];
    }

    memoryDB.drawings[imageId].push(stroke);

    socket.broadcast.emit("draw-stroke", { imageId, stroke });
  });

  socket.on("get-drawing", ({ imageId }, callback) => {
    callback({
      strokes: memoryDB.drawings[imageId] || [],
    });
  });

  socket.on("replace-drawing", ({ imageId, strokes }) => {
    memoryDB.drawings[imageId] = strokes;
    io.emit("drawing-replaced", { imageId, strokes });
  });

  /* =========================
     메모
  ========================= */
  socket.on("add-note", ({ imageId, note }, callback) => {
    if (!memoryDB.notes[imageId]) {
      memoryDB.notes[imageId] = [];
    }

    memoryDB.notes[imageId].push(note);

    io.emit("note-added", { imageId, note });

    callback && callback({ ok: true, note });
  });

  socket.on("get-notes", ({ imageId }, callback) => {
    callback({
      notes: memoryDB.notes[imageId] || [],
    });
  });

  socket.on("update-note", ({ imageId, noteId, patch }) => {
    const notes = memoryDB.notes[imageId] || [];

    const note = notes.find((n) => n.id === noteId);
    if (!note) return;

    Object.assign(note, patch);

    io.emit("note-updated", { imageId, note });
  });

  socket.on("delete-note", ({ imageId, noteId }) => {
    const notes = memoryDB.notes[imageId] || [];
    memoryDB.notes[imageId] = notes.filter((n) => n.id !== noteId);

    io.emit("note-deleted", { imageId, noteId });
  });
});

/* =========================
   서버 실행
========================= */
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
