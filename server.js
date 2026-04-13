const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
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
const MONGODB_URI = process.env.MONGODB_URI || "";

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

let mongoReady = false;

async function connectMongo() {
  if (!MONGODB_URI) {
    console.warn("⚠️ MONGODB_URI가 없습니다. 메모리 모드로 동작합니다.");
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    mongoReady = true;
    console.log("✅ MongoDB 연결 성공");
  } catch (error) {
    mongoReady = false;
    console.error("❌ MongoDB 연결 실패:", error.message);
    console.warn("⚠️ 메모리 모드로 계속 동작합니다.");
  }
}

const MessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, index: true },
    roomId: { type: String, index: true, required: true },
    type: { type: String, enum: ["text", "image"], required: true },
    sender: { type: String, enum: ["user", "admin"], required: true },
    text: { type: String, default: "" },
    imageId: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    time: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

const DrawingStateSchema = new mongoose.Schema(
  {
    roomId: { type: String, index: true, required: true },
    imageId: { type: String, index: true, required: true },
    strokes: { type: Array, default: [] }
  },
  { versionKey: false }
);

const NoteStateSchema = new mongoose.Schema(
  {
    roomId: { type: String, index: true, required: true },
    imageId: { type: String, index: true, required: true },
    notes: { type: Array, default: [] }
  },
  { versionKey: false }
);

const ContactSchema = new mongoose.Schema(
  {
    roomId: { type: String, index: true, required: true },
    phone: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], required: true },
    createdAt: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

MessageSchema.index({ roomId: 1, time: 1, _id: 1 });
DrawingStateSchema.index({ roomId: 1, imageId: 1 }, { unique: true });
NoteStateSchema.index({ roomId: 1, imageId: 1 }, { unique: true });

const MessageModel = mongoose.model("Message", MessageSchema);
const DrawingStateModel = mongoose.model("DrawingState", DrawingStateSchema);
const NoteStateModel = mongoose.model("NoteState", NoteStateSchema);
const ContactModel = mongoose.model("Contact", ContactSchema);

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
  res.json({
    ok: true,
    mongoReady
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
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

const rooms = new Map();
const drawingSaveTimers = new Map();
const noteSaveTimers = new Map();
const drawingLoadedKeys = new Set();
const noteLoadedKeys = new Set();
const memoryContacts = [];
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

app.post("/contact", async (req, res) => {
  const roomId = typeof req.body.roomId === "string" ? req.body.roomId.trim() : "";
  const role = req.body.role === "admin" ? "admin" : "user";
  const phone = sanitizePhone(req.body.phone);

  if (!roomId) {
    return res.status(400).json({
      ok: false,
      error: "roomId가 필요합니다."
    });
  }

  if (phone.length < 8) {
    return res.status(400).json({
      ok: false,
      error: "유효한 전화번호를 입력해주세요."
    });
  }

  const record = {
    roomId,
    phone,
    role,
    createdAt: Date.now()
  };

  memoryContacts.push(record);
  if (memoryContacts.length > 1000) {
    memoryContacts.shift();
  }

  if (mongoReady) {
    try {
      await ContactModel.create(record);
    } catch (error) {
      console.error("연락처 저장 실패:", error.message);
    }
  }

  return res.json({
    ok: true,
    phone
  });
});

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      messages: [],
      drawings: {},
      notes: {},
      socketCount: 0,
      lastActiveAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

function touchRoom(roomId) {
  const room = getRoom(roomId);
  room.lastActiveAt = Date.now();
  return room;
}

function getStateKey(roomId, imageId) {
  return `${roomId}:${imageId}`;
}

function addMemoryMessage(roomId, message) {
  const room = touchRoom(roomId);
  room.messages.push(message);
  if (room.messages.length > 1000) {
    room.messages.shift();
  }
}

function getMemoryDrawingList(roomId, imageId) {
  const room = touchRoom(roomId);
  if (!room.drawings[imageId]) {
    room.drawings[imageId] = [];
  }
  return room.drawings[imageId];
}

function getMemoryNoteList(roomId, imageId) {
  const room = touchRoom(roomId);
  if (!room.notes[imageId]) {
    room.notes[imageId] = [];
  }
  return room.notes[imageId];
}

function sanitizeColor(value, fallback) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || "").trim())
    ? String(value).trim()
    : fallback;
}

function sanitizePhone(value) {
  return String(value || "")
    .replace(/[^\d+]/g, "")
    .slice(0, 20);
}

function sanitizeStroke(stroke = {}) {
  const last = stroke.last || {};
  const current = stroke.current || {};

  return {
    imageId: String(stroke.imageId || ""),
    mode: stroke.mode === "erase" ? "erase" : "draw",
    color: sanitizeColor(stroke.color, "#ff3b30"),
    size: Math.max(1, Math.min(48, Number(stroke.size || 3))),
    last: {
      x: Math.max(0, Math.min(1, Number(last.x || 0))),
      y: Math.max(0, Math.min(1, Number(last.y || 0)))
    },
    current: {
      x: Math.max(0, Math.min(1, Number(current.x || 0))),
      y: Math.max(0, Math.min(1, Number(current.y || 0)))
    }
  };
}

function sanitizeNote(note = {}) {
  return {
    id: String(note.id || uuidv4()),
    x: Math.max(0, Math.min(1, Number(note.x || 0.1))),
    y: Math.max(0, Math.min(1, Number(note.y || 0.1))),
    width: Math.max(0.1, Math.min(0.6, Number(note.width || 0.22))),
    height: Math.max(0.08, Math.min(0.5, Number(note.height || 0.12))),
    text: String(note.text || "").slice(0, 500),
    color: sanitizeColor(note.color, "#fff7c2"),
    author: note.author === "admin" ? "admin" : "user"
  };
}

function scheduleDrawingPersist(roomId, imageId) {
  if (!mongoReady) return;

  const key = getStateKey(roomId, imageId);
  const prev = drawingSaveTimers.get(key);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(async () => {
    drawingSaveTimers.delete(key);

    try {
      await DrawingStateModel.findOneAndUpdate(
        { roomId, imageId },
        { $set: { strokes: getMemoryDrawingList(roomId, imageId) } },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error("스케치 저장 실패:", error.message);
    }
  }, 180);

  drawingSaveTimers.set(key, timer);
}

function scheduleNotePersist(roomId, imageId) {
  if (!mongoReady) return;

  const key = getStateKey(roomId, imageId);
  const prev = noteSaveTimers.get(key);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(async () => {
    noteSaveTimers.delete(key);

    try {
      await NoteStateModel.findOneAndUpdate(
        { roomId, imageId },
        { $set: { notes: getMemoryNoteList(roomId, imageId) } },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error("메모 저장 실패:", error.message);
    }
  }, 180);

  noteSaveTimers.set(key, timer);
}

async function saveMessage(roomId, message) {
  addMemoryMessage(roomId, message);

  if (!mongoReady) return;

  try {
    await MessageModel.create({
      roomId,
      ...message
    });
  } catch (error) {
    console.error("메시지 저장 실패:", error.message);
  }
}

async function loadMessages(roomId) {
  const memory = getRoom(roomId).messages;
  if (!mongoReady) return memory;

  try {
    const docs = await MessageModel.find({ roomId })
      .sort({ time: -1, _id: -1 })
      .limit(1000)
      .lean();

    docs.reverse();
    getRoom(roomId).messages = docs;
    return docs;
  } catch (error) {
    console.error("메시지 로드 실패:", error.message);
    return memory;
  }
}

async function loadDrawingState(roomId, imageId) {
  const key = getStateKey(roomId, imageId);
  const memory = getMemoryDrawingList(roomId, imageId);

  if (!mongoReady || drawingLoadedKeys.has(key)) return memory;

  try {
    const doc = await DrawingStateModel.findOne({ roomId, imageId }).lean();
    const strokes = Array.isArray(doc?.strokes) ? doc.strokes.map(sanitizeStroke) : [];
    getRoom(roomId).drawings[imageId] = strokes;
    drawingLoadedKeys.add(key);
    return strokes;
  } catch (error) {
    console.error("스케치 로드 실패:", error.message);
    return memory;
  }
}

async function replaceDrawingState(roomId, imageId, strokes) {
  getRoom(roomId).drawings[imageId] = Array.isArray(strokes)
    ? strokes.map(sanitizeStroke)
    : [];

  drawingLoadedKeys.add(getStateKey(roomId, imageId));
  scheduleDrawingPersist(roomId, imageId);
}

async function loadNoteState(roomId, imageId) {
  const key = getStateKey(roomId, imageId);
  const memory = getMemoryNoteList(roomId, imageId);

  if (!mongoReady || noteLoadedKeys.has(key)) return memory;

  try {
    const doc = await NoteStateModel.findOne({ roomId, imageId }).lean();
    const notes = Array.isArray(doc?.notes) ? doc.notes.map(sanitizeNote) : [];
    getRoom(roomId).notes[imageId] = notes;
    noteLoadedKeys.add(key);
    return notes;
  } catch (error) {
    console.error("메모 로드 실패:", error.message);
    return memory;
  }
}

async function replaceNoteState(roomId, imageId, notes) {
  getRoom(roomId).notes[imageId] = Array.isArray(notes)
    ? notes.map(sanitizeNote)
    : [];

  noteLoadedKeys.add(getStateKey(roomId, imageId));
  scheduleNotePersist(roomId, imageId);
}

io.on("connection", (socket) => {
  let currentRoomId = null;
  let currentRole = "user";

  socket.on("join", async (payload = {}) => {
    const roomId =
      typeof payload.roomId === "string" && payload.roomId.trim()
        ? payload.roomId.trim()
        : null;

    const role = payload.role === "admin" ? "admin" : "user";
    if (!roomId) return;

    currentRoomId = roomId;
    currentRole = role;

    socket.join(currentRoomId);
    touchRoom(currentRoomId).socketCount += 1;

    const messages = await loadMessages(currentRoomId);
    socket.emit("history", messages);
  });

  socket.on("message", async (payload = {}) => {
    if (!currentRoomId) return;

    const text = String(payload.text || "").trim();
    if (!text) return;

    const message = {
      id: uuidv4(),
      type: "text",
      sender: currentRole,
      text: text.slice(0, 2000),
      imageId: "",
      imageUrl: "",
      time: Date.now()
    };

    await saveMessage(currentRoomId, message);
    io.to(currentRoomId).emit("message", message);
  });

  socket.on("image", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageUrl = String(payload.url || "").trim();
    if (!imageUrl) return;

    const imageMessage = {
      id: uuidv4(),
      type: "image",
      sender: currentRole,
      text: "",
      imageId: uuidv4(),
      imageUrl,
      time: Date.now()
    };

    await saveMessage(currentRoomId, imageMessage);
    await replaceDrawingState(currentRoomId, imageMessage.imageId, []);
    await replaceNoteState(currentRoomId, imageMessage.imageId, []);

    io.to(currentRoomId).emit("image", imageMessage);
  });

  socket.on("request-drawing-history", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const strokes = await loadDrawingState(currentRoomId, imageId);
    socket.emit("drawing-history", { imageId, strokes });
  });

  socket.on("draw-stroke", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const stroke = sanitizeStroke(payload);
    if (!stroke.imageId) stroke.imageId = imageId;

    const strokes = await loadDrawingState(currentRoomId, imageId);
    strokes.push(stroke);
    if (strokes.length > 5000) strokes.shift();

    scheduleDrawingPersist(currentRoomId, imageId);
    socket.to(currentRoomId).emit("draw-stroke", stroke);
  });

  socket.on("draw-strokes", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    const incoming = Array.isArray(payload.strokes) ? payload.strokes : [];
    if (!imageId || incoming.length === 0) return;

    const strokes = await loadDrawingState(currentRoomId, imageId);
    const sanitized = incoming
      .slice(0, 200)
      .map((stroke) => sanitizeStroke({ ...stroke, imageId }));

    sanitized.forEach((stroke) => strokes.push(stroke));
    if (strokes.length > 5000) {
      strokes.splice(0, strokes.length - 5000);
    }

    scheduleDrawingPersist(currentRoomId, imageId);
    socket.to(currentRoomId).emit("draw-strokes", {
      imageId,
      strokes: sanitized
    });
  });

  socket.on("replace-drawing-history", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    const strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
    if (!imageId) return;

    await replaceDrawingState(currentRoomId, imageId, strokes);
    io.to(currentRoomId).emit("drawing-history", {
      imageId,
      strokes: getMemoryDrawingList(currentRoomId, imageId)
    });
  });

  socket.on("clear-drawing", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    await replaceDrawingState(currentRoomId, imageId, []);
    io.to(currentRoomId).emit("clear-drawing", { imageId });
  });

  socket.on("request-note-history", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    const notes = await loadNoteState(currentRoomId, imageId);
    socket.emit("note-history", { imageId, notes });
  });

  socket.on("add-note", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    if (!imageId || !payload.note) return;

    const note = sanitizeNote({
      ...payload.note,
      author: currentRole
    });

    const notes = await loadNoteState(currentRoomId, imageId);
    notes.push(note);

    scheduleNotePersist(currentRoomId, imageId);
    io.to(currentRoomId).emit("note-added", { imageId, note });
  });

  socket.on("note-live-update", (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    const noteId = String(payload.noteId || "").trim();
    const patch = payload.patch || {};

    if (!imageId || !noteId) return;

    socket.to(currentRoomId).emit("note-live-update", {
      imageId,
      noteId,
      patch
    });
  });

  socket.on("update-note", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    const noteId = String(payload.noteId || "").trim();
    const patch = payload.patch || {};

    if (!imageId || !noteId) return;

    const notes = await loadNoteState(currentRoomId, imageId);
    const target = notes.find((n) => n.id === noteId);
    if (!target) return;

    if (typeof patch.x === "number") target.x = Math.max(0, Math.min(1, patch.x));
    if (typeof patch.y === "number") target.y = Math.max(0, Math.min(1, patch.y));
    if (typeof patch.width === "number") target.width = Math.max(0.1, Math.min(0.6, patch.width));
    if (typeof patch.height === "number") target.height = Math.max(0.08, Math.min(0.5, patch.height));
    if (typeof patch.text === "string") target.text = patch.text.slice(0, 500);
    if (typeof patch.color === "string") target.color = sanitizeColor(patch.color, target.color);

    scheduleNotePersist(currentRoomId, imageId);
    io.to(currentRoomId).emit("note-updated", {
      imageId,
      noteId,
      patch: {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
        text: target.text,
        color: target.color
      }
    });
  });

  socket.on("replace-note-history", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    const notes = Array.isArray(payload.notes) ? payload.notes : [];
    if (!imageId) return;

    await replaceNoteState(currentRoomId, imageId, notes);
    io.to(currentRoomId).emit("note-history", {
      imageId,
      notes: getMemoryNoteList(currentRoomId, imageId)
    });
  });

  socket.on("delete-note", async (payload = {}) => {
    if (!currentRoomId) return;

    const imageId = String(payload.imageId || "").trim();
    const noteId = String(payload.noteId || "").trim();
    if (!imageId || !noteId) return;

    const notes = await loadNoteState(currentRoomId, imageId);
    getRoom(currentRoomId).notes[imageId] = notes.filter((note) => note.id !== noteId);

    scheduleNotePersist(currentRoomId, imageId);
    io.to(currentRoomId).emit("note-deleted", { imageId, noteId });
  });

  socket.on("clear-notes", async (payload = {}) => {
    if (!currentRoomId) return;
    const imageId = String(payload.imageId || "").trim();
    if (!imageId) return;

    await replaceNoteState(currentRoomId, imageId, []);
    io.to(currentRoomId).emit("clear-notes", { imageId });
  });

  socket.on("disconnect", () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;

    const room = getRoom(currentRoomId);
    room.socketCount = Math.max(0, room.socketCount - 1);
    room.lastActiveAt = Date.now();
  });
});

connectMongo().finally(() => {
  server.listen(PORT, () => {
    console.log(`🚀 서버 실행: ${PORT}`);
  });
});

async function flushPendingState() {
  if (!mongoReady) return;

  const drawingKeys = Array.from(drawingSaveTimers.keys());
  const noteKeys = Array.from(noteSaveTimers.keys());

  drawingKeys.forEach((key) => {
    const timer = drawingSaveTimers.get(key);
    if (timer) clearTimeout(timer);
    drawingSaveTimers.delete(key);
  });

  noteKeys.forEach((key) => {
    const timer = noteSaveTimers.get(key);
    if (timer) clearTimeout(timer);
    noteSaveTimers.delete(key);
  });

  const drawingJobs = drawingKeys.map(async (key) => {
    const [roomId, imageId] = key.split(":");
    if (!roomId || !imageId) return;

    try {
      await DrawingStateModel.findOneAndUpdate(
        { roomId, imageId },
        { $set: { strokes: getMemoryDrawingList(roomId, imageId) } },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error("종료 전 스케치 저장 실패:", error.message);
    }
  });

  const noteJobs = noteKeys.map(async (key) => {
    const [roomId, imageId] = key.split(":");
    if (!roomId || !imageId) return;

    try {
      await NoteStateModel.findOneAndUpdate(
        { roomId, imageId },
        { $set: { notes: getMemoryNoteList(roomId, imageId) } },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error("종료 전 메모 저장 실패:", error.message);
    }
  });

  await Promise.allSettled([...drawingJobs, ...noteJobs]);
}

function pruneInactiveRooms() {
  const now = Date.now();

  rooms.forEach((room, roomId) => {
    if (room.socketCount > 0) return;
    if (now - room.lastActiveAt < ROOM_TTL_MS) return;

    Object.keys(room.drawings).forEach((imageId) => {
      drawingLoadedKeys.delete(getStateKey(roomId, imageId));
      drawingSaveTimers.delete(getStateKey(roomId, imageId));
    });

    Object.keys(room.notes).forEach((imageId) => {
      noteLoadedKeys.delete(getStateKey(roomId, imageId));
      noteSaveTimers.delete(getStateKey(roomId, imageId));
    });

    rooms.delete(roomId);
  });
}

setInterval(pruneInactiveRooms, 1000 * 60 * 10).unref();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} 신호 수신, 서버를 종료합니다.`);

  try {
    await flushPendingState();
  } finally {
    server.close(async () => {
      if (mongoReady) {
        await mongoose.disconnect().catch(() => {});
      }
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 5000).unref();
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
