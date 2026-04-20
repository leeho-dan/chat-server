const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { v2: cloudinary } = require("cloudinary");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const APP_VERSION = process.env.APP_VERSION || "20260420-3";

const MAX_MESSAGES_PER_ROOM = Number(process.env.MAX_MESSAGES_PER_ROOM || 300);
const MAX_NOTES_PER_IMAGE = Number(process.env.MAX_NOTES_PER_IMAGE || 80);
const MAX_STROKES_PER_IMAGE = Number(process.env.MAX_STROKES_PER_IMAGE || 500);

const ALLOWED_ORIGINS = String(process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function corsOriginHandler(origin, callback) {
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  return callback(new Error("CORS not allowed"));
}

app.use(cors({ origin: corsOriginHandler, credentials: false }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log("[REQ]", req.method, req.url);
    next();
  });
}

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get(/^\/(index\.html)?$/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

let mongoEnabled = false;
let mongoAvailable = false;
let cloudinaryEnabled = false;

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    uptime: process.uptime(),
    mongoEnabled,
    mongoReady: mongoose.connection.readyState === 1,
    cloudinaryEnabled
  });
});

app.get("/config", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    socketPath: "/socket.io",
    maxUploadMb: 20,
    mongoEnabled,
    mongoReady: mongoose.connection.readyState === 1,
    cloudinaryEnabled
  });
});

const hasCloudinaryEnv =
  process.env.CLOUD_NAME &&
  process.env.CLOUD_KEY &&
  process.env.CLOUD_SECRET;

if (hasCloudinaryEnv) {
  cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_KEY,
    api_secret: process.env.CLOUD_SECRET,
    secure: true
  });
  cloudinaryEnabled = true;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file || !file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("이미지 파일만 업로드할 수 있습니다."));
    }
    cb(null, true);
  }
});

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    type: { type: String, enum: ["text", "image", "system"], required: true },
    text: { type: String, default: "" },
    imageId: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    sender: { type: String, enum: ["user", "admin", "system"], required: true },
    senderName: { type: String, required: true },
    time: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

const drawingSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    imageId: { type: String, required: true, index: true },
    strokes: { type: Array, default: [] },
    updatedAt: { type: Number, default: Date.now }
  },
  { versionKey: false }
);

drawingSchema.index({ roomId: 1, imageId: 1 }, { unique: true });

const noteSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    imageId: { type: String, required: true, index: true },
    noteId: { type: String, required: true },
    x: { type: Number, default: 0.14 },
    y: { type: Number, default: 0.16 },
    width: { type: Number, default: 0.16 },
    height: { type: Number, default: 0.1 },
    text: { type: String, default: "" },
    color: { type: String, default: "#fff7c2" },
    author: { type: String, enum: ["user", "admin"], default: "user" },
    updatedAt: { type: Number, default: Date.now },
    updatedByRole: { type: String, enum: ["user", "admin"], default: "user" },
    updatedByName: { type: String, default: "고객" }
  },
  { versionKey: false }
);

noteSchema.index({ roomId: 1, imageId: 1, noteId: 1 }, { unique: true });

const Message = mongoose.model("Message", messageSchema);
const Drawing = mongoose.model("Drawing", drawingSchema);
const Note = mongoose.model("Note", noteSchema);

const memoryStore = {
  rooms: new Map()
};

function getMemoryRoom(roomId) {
  if (!memoryStore.rooms.has(roomId)) {
    memoryStore.rooms.set(roomId, {
      messages: [],
      drawings: new Map(),
      notes: new Map()
    });
  }
  return memoryStore.rooms.get(roomId);
}

function sanitizeRole(role) {
  return role === "admin" ? "admin" : "user";
}

function sanitizeUserName(userName, role) {
  const name = String(userName || "").trim().slice(0, 60);
  if (role === "admin") return "관리자";
  return name || "고객";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeMessage(message = {}, fallbackRole = "user", fallbackUserName = "고객") {
  const sender = sanitizeRole(message.sender || fallbackRole);
  const senderName = sender === "admin" ? "관리자" : sanitizeUserName(message.senderName || fallbackUserName, sender);
  const type = ["text", "image", "system"].includes(message.type) ? message.type : "text";

  return {
    type,
    text: String(message.text || "").slice(0, 5000),
    imageId: String(message.imageId || "").slice(0, 120),
    imageUrl: String(message.imageUrl || "").slice(0, 5000),
    sender: type === "system" ? "system" : sender,
    senderName: type === "system" ? "시스템" : senderName,
    time: typeof message.time === "number" ? message.time : Date.now()
  };
}

function normalizePoint(point = {}) {
  return {
    x: clamp(Number(point.x || 0), 0, 1),
    y: clamp(Number(point.y || 0), 0, 1)
  };
}

function normalizeStroke(stroke = {}) {
  const mode = stroke.mode === "erase" ? "erase" : "draw";
  const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(stroke.color || ""))
    ? String(stroke.color)
    : "#ff3b30";
  const width = clamp(Number(stroke.width || 3), 1, 24);
  const points = Array.isArray(stroke.points) ? stroke.points.slice(0, 200).map(normalizePoint) : [];

  return {
    id: String(stroke.id || uuidv4()),
    mode,
    color,
    width,
    points,
    time: typeof stroke.time === "number" ? stroke.time : Date.now(),
    sender: sanitizeRole(stroke.sender || "user")
  };
}

function normalizeNote(note = {}, fallbackRole = "user", fallbackUserName = "고객") {
  const updatedByRole = sanitizeRole(note.updatedByRole || fallbackRole);
  const updatedByName =
    updatedByRole === "admin"
      ? "관리자"
      : sanitizeUserName(note.updatedByName || fallbackUserName, updatedByRole);

  return {
    noteId: String(note.id || note.noteId || uuidv4()),
    x: typeof note.x === "number" ? clamp(note.x, 0.06, 0.94) : 0.14,
    y: typeof note.y === "number" ? clamp(note.y, 0.08, 0.92) : 0.16,
    width: typeof note.width === "number" ? clamp(note.width, 0.12, 0.3) : 0.16,
    height: typeof note.height === "number" ? clamp(note.height, 0.09, 0.28) : 0.1,
    text: String(note.text || "").slice(0, 500),
    color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(note.color || "")) ? String(note.color) : "#fff7c2",
    author: sanitizeRole(note.author || fallbackRole),
    updatedAt: typeof note.updatedAt === "number" ? note.updatedAt : Date.now(),
    updatedByRole,
    updatedByName
  };
}

function normalizeNotePatch(patch = {}, fallbackRole = "user", fallbackUserName = "고객") {
  const next = {};

  if (typeof patch.x === "number") next.x = clamp(patch.x, 0.06, 0.94);
  if (typeof patch.y === "number") next.y = clamp(patch.y, 0.08, 0.92);
  if (typeof patch.width === "number") next.width = clamp(patch.width, 0.12, 0.3);
  if (typeof patch.height === "number") next.height = clamp(patch.height, 0.09, 0.28);
  if (typeof patch.text === "string") next.text = patch.text.slice(0, 500);
  if (typeof patch.color === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.color)) next.color = patch.color;

  next.updatedAt = typeof patch.updatedAt === "number" ? patch.updatedAt : Date.now();

  const updatedByRole = sanitizeRole(patch.updatedByRole || fallbackRole);
  next.updatedByRole = updatedByRole;
  next.updatedByName =
    updatedByRole === "admin"
      ? "관리자"
      : sanitizeUserName(patch.updatedByName || fallbackUserName, updatedByRole);

  return next;
}

async function ensureMongoConnected() {
  const uri = process.env.MONGODB_URI;
  mongoEnabled = Boolean(uri);

  if (!uri) {
    console.warn("[MONGO] MONGODB_URI 없음. 메모리 모드로 실행합니다.");
    mongoAvailable = false;
    return;
  }

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    mongoAvailable = true;
    return;
  }

  try {
    await mongoose.connect(uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 8000
    });
    mongoAvailable = true;
    console.log("[MONGO] connected");
  } catch (error) {
    mongoAvailable = false;
    console.error("[MONGO] connect failed. 메모리 모드로 계속 실행합니다.", error.message);
  }
}

async function getMessageHistory(roomId) {
  if (mongoAvailable) {
    return Message.find({ roomId }).sort({ time: 1 }).limit(MAX_MESSAGES_PER_ROOM).lean();
  }
  return getMemoryRoom(roomId).messages.slice(-MAX_MESSAGES_PER_ROOM);
}

async function appendMessage(roomId, message) {
  const normalized = normalizeMessage(message, message.sender, message.senderName);

  if (mongoAvailable) {
    await Message.create({ roomId, ...normalized });

    const count = await Message.countDocuments({ roomId });
    if (count > MAX_MESSAGES_PER_ROOM) {
      const overflow = count - MAX_MESSAGES_PER_ROOM;
      const oldDocs = await Message.find({ roomId })
        .sort({ time: 1 })
        .limit(overflow)
        .select("_id")
        .lean();

      if (oldDocs.length) {
        await Message.deleteMany({ _id: { $in: oldDocs.map((doc) => doc._id) } });
      }
    }

    return normalized;
  }

  const room = getMemoryRoom(roomId);
  room.messages.push(normalized);
  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages.splice(0, room.messages.length - MAX_MESSAGES_PER_ROOM);
  }
  return normalized;
}

async function getDrawingHistory(roomId, imageId) {
  if (mongoAvailable) {
    const doc = await Drawing.findOne({ roomId, imageId }).lean();
    return doc?.strokes || [];
  }
  return getMemoryRoom(roomId).drawings.get(imageId) || [];
}

async function replaceDrawingHistory(roomId, imageId, strokes) {
  const safeStrokes = Array.isArray(strokes)
    ? strokes.slice(-MAX_STROKES_PER_IMAGE).map(normalizeStroke)
    : [];

  if (mongoAvailable) {
    await Drawing.findOneAndUpdate(
      { roomId, imageId },
      { $set: { strokes: safeStrokes, updatedAt: Date.now() } },
      { upsert: true, new: true }
    );
    return safeStrokes;
  }

  const room = getMemoryRoom(roomId);
  room.drawings.set(imageId, safeStrokes);
  return safeStrokes;
}

async function appendDrawStroke(roomId, imageId, stroke) {
  const current = await getDrawingHistory(roomId, imageId);
  current.push(normalizeStroke(stroke));
  return replaceDrawingHistory(roomId, imageId, current);
}

async function clearDrawingHistory(roomId, imageId) {
  if (mongoAvailable) {
    await Drawing.findOneAndUpdate(
      { roomId, imageId },
      { $set: { strokes: [], updatedAt: Date.now() } },
      { upsert: true, new: true }
    );
    return;
  }

  getMemoryRoom(roomId).drawings.set(imageId, []);
}

async function getNotes(roomId, imageId) {
  if (mongoAvailable) {
    const docs = await Note.find({ roomId, imageId }).sort({ updatedAt: 1 }).lean();
    return docs.map((note) => ({
      id: note.noteId,
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
      text: note.text,
      color: note.color,
      author: note.author,
      updatedAt: note.updatedAt,
      updatedByRole: note.updatedByRole,
      updatedByName: note.updatedByName
    }));
  }

  const items = Array.from((getMemoryRoom(roomId).notes.get(imageId) || new Map()).values());
  return items.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
}

async function addOrGetNote(roomId, imageId, normalized) {
  if (mongoAvailable) {
    const existing = await Note.findOne({ roomId, imageId, noteId: normalized.noteId }).lean();
    if (existing) {
      return {
        id: existing.noteId,
        x: existing.x,
        y: existing.y,
        width: existing.width,
        height: existing.height,
        text: existing.text,
        color: existing.color,
        author: existing.author,
        updatedAt: existing.updatedAt,
        updatedByRole: existing.updatedByRole,
        updatedByName: existing.updatedByName
      };
    }

    const created = await Note.create({ roomId, imageId, ...normalized });
    return {
      id: created.noteId,
      x: created.x,
      y: created.y,
      width: created.width,
      height: created.height,
      text: created.text,
      color: created.color,
      author: created.author,
      updatedAt: created.updatedAt,
      updatedByRole: created.updatedByRole,
      updatedByName: created.updatedByName
    };
  }

  const room = getMemoryRoom(roomId);
  const imageMap = room.notes.get(imageId) || new Map();
  room.notes.set(imageId, imageMap);

  if (imageMap.has(normalized.noteId)) {
    return imageMap.get(normalized.noteId);
  }

  const note = {
    id: normalized.noteId,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    text: normalized.text,
    color: normalized.color,
    author: normalized.author,
    updatedAt: normalized.updatedAt,
    updatedByRole: normalized.updatedByRole,
    updatedByName: normalized.updatedByName
  };

  imageMap.set(note.id, note);
  return note;
}

async function updateNote(roomId, imageId, noteId, patch) {
  if (mongoAvailable) {
    const updated = await Note.findOneAndUpdate(
      { roomId, imageId, noteId },
      { $set: patch },
      { new: true }
    ).lean();

    if (!updated) return null;

    return {
      id: updated.noteId,
      x: updated.x,
      y: updated.y,
      width: updated.width,
      height: updated.height,
      text: updated.text,
      color: updated.color,
      author: updated.author,
      updatedAt: updated.updatedAt,
      updatedByRole: updated.updatedByRole,
      updatedByName: updated.updatedByName
    };
  }

  const room = getMemoryRoom(roomId);
  const imageMap = room.notes.get(imageId) || new Map();
  if (!imageMap.has(noteId)) return null;

  const current = imageMap.get(noteId);
  const updated = { ...current, ...patch };
  imageMap.set(noteId, updated);
  return updated;
}

async function deleteNote(roomId, imageId, noteId) {
  if (mongoAvailable) {
    await Note.deleteOne({ roomId, imageId, noteId });
    return;
  }

  const room = getMemoryRoom(roomId);
  const imageMap = room.notes.get(imageId) || new Map();
  imageMap.delete(noteId);
}

app.post(
  "/upload",
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (!err) return next();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: "이미지 용량이 너무 큽니다. 20MB 이하만 가능합니다."
          });
        }
        return res.status(400).json({ error: "업로드 처리 중 오류가 발생했습니다." });
      }

      return res.status(400).json({ error: err.message || "업로드 실패" });
    });
  },
  async (req, res) => {
    try {
      if (!cloudinaryEnabled) {
        return res.status(500).json({ error: "Cloudinary 환경변수가 설정되지 않았습니다." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "파일 없음" });
      }

      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "design-chat",
            resource_type: "image"
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );

        stream.end(req.file.buffer);
      });

      return res.json({
        ok: true,
        url: uploaded.secure_url
      });
    } catch (error) {
      console.error("upload error:", error);
      return res.status(500).json({ error: "이미지 업로드 실패" });
    }
  }
);

function emitErrorAck(ack, error) {
  if (ack) ack({ ok: false, error });
}

io.on("connection", (socket) => {
  socket.data.roomId = "";
  socket.data.role = "user";
  socket.data.userName = "고객";

  socket.on("join", async (payload = {}, ack) => {
    try {
      const roomId = String(payload.roomId || "").trim();
      if (!roomId) return emitErrorAck(ack, "roomId 필요");

      const role = sanitizeRole(payload.role || "user");
      const userName = sanitizeUserName(payload.userName || "고객", role);

      if (socket.data.roomId) {
        socket.leave(socket.data.roomId);
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = role;
      socket.data.userName = userName;

      const messages = await getMessageHistory(roomId);
      socket.emit("history", { messages });

      if (ack) ack({ ok: true, roomId, role, userName });
    } catch (error) {
      console.error("join error:", error);
      emitErrorAck(ack, "입장 오류");
    }
  });

  socket.on("message", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return emitErrorAck(ack, "join 필요");

      const text = String(payload.text || "").trim();
      if (!text) return emitErrorAck(ack, "메시지 없음");

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const message = await appendMessage(roomId, {
        type: "text",
        text,
        sender: role,
        senderName: userName,
        time: Date.now()
      });

      io.to(roomId).emit("message", message);
      if (ack) ack({ ok: true, message });
    } catch (error) {
      console.error("message error:", error);
      emitErrorAck(ack, "메시지 저장 오류");
    }
  });

  socket.on("image", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return emitErrorAck(ack, "join 필요");

      const imageUrl = String(payload.url || "").trim();
      if (!imageUrl) return emitErrorAck(ack, "이미지 URL 없음");

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);
      const imageId = uuidv4();

      const message = await appendMessage(roomId, {
        type: "image",
        imageId,
        imageUrl,
        sender: role,
        senderName: userName,
        time: Date.now()
      });

      io.to(roomId).emit("message", message);
      if (ack) ack({ ok: true, imageId, message });
    } catch (error) {
      console.error("image error:", error);
      emitErrorAck(ack, "이미지 저장 오류");
    }
  });

  socket.on("get-drawing", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      const strokes = await getDrawingHistory(roomId, imageId);
      if (ack) ack({ ok: true, strokes });
    } catch (error) {
      console.error("get-drawing error:", error);
      emitErrorAck(ack, "드로잉 불러오기 오류");
    }
  });

  socket.on("replace-drawing", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      const strokes = await replaceDrawingHistory(roomId, imageId, payload.strokes || []);
      io.to(roomId).emit("drawing-replaced", { imageId, strokes });
      if (ack) ack({ ok: true, strokes });
    } catch (error) {
      console.error("replace-drawing error:", error);
      emitErrorAck(ack, "드로잉 저장 오류");
    }
  });

  socket.on("draw-stroke", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      const stroke = normalizeStroke(payload.stroke || {});
      await appendDrawStroke(roomId, imageId, stroke);

      io.to(roomId).emit("draw-stroke", { imageId, stroke });
      if (ack) ack({ ok: true, stroke });
    } catch (error) {
      console.error("draw-stroke error:", error);
      emitErrorAck(ack, "드로잉 저장 오류");
    }
  });

  socket.on("clear-drawing", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      await clearDrawingHistory(roomId, imageId);
      io.to(roomId).emit("drawing-cleared", { imageId });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("clear-drawing error:", error);
      emitErrorAck(ack, "드로잉 초기화 오류");
    }
  });

  socket.on("get-notes", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      const notes = await getNotes(roomId, imageId);
      if (ack) ack({ ok: true, notes });
      else socket.emit("notes", { imageId, notes });
    } catch (error) {
      console.error("get-notes error:", error);
      emitErrorAck(ack, "메모 불러오기 오류");
    }
  });

  socket.on("add-note", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return emitErrorAck(ack, "필수값 없음");

      const note = await addOrGetNote(
        roomId,
        imageId,
        normalizeNote(payload.note || {}, socket.data.role, socket.data.userName)
      );

      io.to(roomId).emit("note-added", { imageId, note });
      if (ack) ack({ ok: true, note });
    } catch (error) {
      console.error("add-note error:", error);
      emitErrorAck(ack, "메모 추가 오류");
    }
  });

  socket.on("update-note", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) return emitErrorAck(ack, "필수값 없음");

      const patch = normalizeNotePatch(payload.patch || {}, socket.data.role, socket.data.userName);
      const note = await updateNote(roomId, imageId, noteId, patch);
      if (!note) return emitErrorAck(ack, "메모를 찾을 수 없습니다.");

      io.to(roomId).emit("note-updated", { imageId, note });
      if (ack) ack({ ok: true, note });
    } catch (error) {
      console.error("update-note error:", error);
      emitErrorAck(ack, "메모 수정 오류");
    }
  });

  socket.on("delete-note", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) return emitErrorAck(ack, "필수값 없음");

      await deleteNote(roomId, imageId, noteId);
      io.to(roomId).emit("note-deleted", { imageId, noteId });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("delete-note error:", error);
      emitErrorAck(ack, "메모 삭제 오류");
    }
  });
});

app.get("*", (req, res, next) => {
  if (
    req.path.startsWith("/socket.io") ||
    req.path.startsWith("/upload") ||
    req.path.startsWith("/health") ||
    req.path.startsWith("/config")
  ) {
    return next();
  }

  if (req.method === "GET") {
    return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  }

  next();
});

async function start() {
  await ensureMongoConnected();

  server.listen(PORT, HOST, () => {
    console.log(`[SERVER] listening on http://${HOST}:${PORT}`);
    console.log(`[SERVER] version=${APP_VERSION}`);
  });
}

start().catch((error) => {
  console.error("[SERVER] startup failed:", error);
  process.exit(1);
});
