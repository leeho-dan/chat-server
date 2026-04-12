const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
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
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

// uploads 폴더가 없으면 자동 생성
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

/* =========================
   이미지 업로드 설정
========================= */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
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
      return res.status(400).json({
        ok: false,
        error: err.message || "이미지 업로드에 실패했습니다."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "업로드된 파일이 없습니다."
      });
    }

    return res.json({
      ok: true,
      url: `/uploads/${req.file.filename}`
    });
  });
});

/* =========================
   메모리 기반 데이터 저장소
   - room별 채팅 메시지
   - room / imageId별 스케치 이력
========================= */
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

function addMessage(roomId, message) {
  const room = getRoom(roomId);
  room.messages.push(message);

  // 메모리 과다 사용 방지
  if (room.messages.length > 1000) {
    room.messages.shift();
  }
}

function getDrawingList(roomId, imageId) {
  const room = getRoom(roomId);
  if (!room.drawings[imageId]) {
    room.drawings[imageId] = [];
  }
  return room.drawings[imageId];
}

/* =========================
   Socket.IO 실시간 통신
========================= */
io.on("connection", (socket) => {
  let currentRoomId = null;
  let currentRole = "user";

  // 채팅방 입장
  socket.on("join", (payload = {}) => {
    const roomId =
      typeof payload.roomId === "string" && payload.roomId.trim()
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

  // 텍스트 메시지
  socket.on("message", (payload = {}) => {
    if (!currentRoomId) return;

    const text = String(payload.text || "").trim();
    if (!text) return;

    const message = {
      id: uuidv4(),
      type: "text",
      sender: currentRole,
      text: text.slice(0, 2000),
      time: Date.now()
    };

    addMessage(currentRoomId, message);
    io.to(currentRoomId).emit("message", message);
  });

  // 이미지 메시지
  socket.on("image", (payload = {}) => {
    if (!currentRoomId) return;

    const imageUrl = String(payload.url || "").trim();
    if (!imageUrl) return;

    const imageMessage = {
      id: uuidv4(),
      type: "image",
      sender: currentRole,
      imageId: uuidv4(),
      imageUrl,
      time: Date.now()
    };

    addMessage(currentRoomId, imageMessage);

    // 해당 이미지용 스케치 배열 미리 생성
    getDrawingList(currentRoomId, imageMessage.imageId);

    io.to(currentRoomId).emit("image", imageMessage);
  });

  // 특정 이미지의 기존 스케치 이력 요청
  socket.on("request-drawing-history", (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const strokes = getDrawingList(currentRoomId, imageId);

    socket.emit("drawing-history", {
      imageId,
      strokes
    });
  });

  // 스케치 한 줄 그리기
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
      !last ||
      !current ||
      typeof last.x !== "number" ||
      typeof last.y !== "number" ||
      typeof current.x !== "number" ||
      typeof current.y !== "number"
    ) {
      return;
    }

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

    const drawingList = getDrawingList(currentRoomId, imageId);
    drawingList.push(stroke);

    if (drawingList.length > 5000) {
      drawingList.shift();
    }

    socket.to(currentRoomId).emit("draw-stroke", stroke);
  });

  // 전체 스케치 지우기
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
