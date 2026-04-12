const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "public", "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("이미지 파일만 업로드할 수 있습니다."));
    }
    cb(null, true);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/upload", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "업로드 실패" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "업로드된 파일이 없습니다." });
    }

    return res.json({
      ok: true,
      url: `/uploads/${req.file.filename}`
    });
  });
});

/*
  메모리 구조
  rooms = {
    [roomId]: {
      messages: [],
      drawings: {
        [imageId]: [ stroke, stroke, ... ]
      }
    }
  }
*/
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      messages: [],
      drawings: {}
    });
  }
  return rooms.get(roomId);
}

io.on("connection", (socket) => {
  let currentRoomId = null;
  let currentRole = "user";

  socket.on("join", (payload = {}) => {
    const roomId = typeof payload.roomId === "string" && payload.roomId.trim()
      ? payload.roomId.trim()
      : null;

    const role = payload.role === "admin" ? "admin" : "user";

    if (!roomId) return;

    currentRoomId = roomId;
    currentRole = role;

    socket.join(currentRoomId);

    const room = getRoom(currentRoomId);
    socket.emit("history", room.messages);
  });

  socket.on("message", (payload = {}) => {
    if (!currentRoomId) return;

    const text = String(payload.text || "").trim();
    if (!text) return;

    const room = getRoom(currentRoomId);

    const message = {
      id: uuidv4(),
      type: "text",
      sender: currentRole,
      text: text.slice(0, 2000),
      time: Date.now()
    };

    room.messages.push(message);
    if (room.messages.length > 500) room.messages.shift();

    io.to(currentRoomId).emit("message", message);
  });

  socket.on("image", (payload = {}) => {
    if (!currentRoomId) return;

    const url = String(payload.url || "").trim();
    if (!url) return;

    const room = getRoom(currentRoomId);
    const imageId = uuidv4();

    const message = {
      id: uuidv4(),
      type: "image",
      sender: currentRole,
      imageId,
      imageUrl: url,
      time: Date.now()
    };

    room.messages.push(message);
    room.drawings[imageId] = room.drawings[imageId] || [];

    if (room.messages.length > 500) room.messages.shift();

    io.to(currentRoomId).emit("image", message);
  });

  socket.on("request-drawing-history", (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const room = getRoom(currentRoomId);
    const strokes = room.drawings[imageId] || [];

    socket.emit("drawing-history", {
      imageId,
      strokes
    });
  });

  socket.on("draw-stroke", (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const mode = payload.mode === "erase" ? "erase" : "draw";
    const color = typeof payload.color === "string" ? payload.color : "#ff3b30";
    const size = Math.max(1, Math.min(48, Number(payload.size || 3)));
    const last = payload.last;
    const current = payload.current;

    if (
      !last || !current ||
      typeof last.x !== "number" || typeof last.y !== "number" ||
      typeof current.x !== "number" || typeof current.y !== "number"
    ) {
      return;
    }

    const room = getRoom(currentRoomId);
    room.drawings[imageId] = room.drawings[imageId] || [];

    const stroke = {
      imageId,
      mode,
      color,
      size,
      last: {
        x: Math.max(0, Math.min(1, last.x)),
        y: Math.max(0, Math.min(1, last.y))
      },
      current: {
        x: Math.max(0, Math.min(1, current.x)),
        y: Math.max(0, Math.min(1, current.y))
      }
    };

    room.drawings[imageId].push(stroke);

    if (room.drawings[imageId].length > 5000) {
      room.drawings[imageId].shift();
    }

    socket.to(currentRoomId).emit("draw-stroke", stroke);
  });

  socket.on("clear-drawing", (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const room = getRoom(currentRoomId);
    room.drawings[imageId] = [];

    io.to(currentRoomId).emit("clear-drawing", { imageId });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 서버 실행: ${PORT}`);
});
