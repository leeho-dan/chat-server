const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { v2: cloudinary } = require("cloudinary");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const ALLOWED_ORIGINS = String(process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const corsOriginHandler = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
  if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  return callback(new Error("CORS not allowed"));
};

app.use(cors({ origin: corsOriginHandler, credentials: false }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.url);
  next();
});

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

app.get("/health", async (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  res.json({
    ok: true,
    uptime: process.uptime(),
    mongoReady
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
    type: { type: String, enum: ["text", "image"], required: true },
    text: { type: String, default: "" },
    imageId: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    sender: { type: String, enum: ["user", "admin"], required: true },
    senderName: { type: String, required: true },
    time: { type: Number, required: true, index: true }
  },
  { versionKey: false }
);

const drawingSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    imageId: { type: String, required: true, index: true },
    strokes: { type: Array, default: [] }
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

function normalizeNote(note = {}, fallbackRole = "user", fallbackUserName = "고객") {
  const updatedByRole = sanitizeRole(note.updatedByRole || fallbackRole);
  const updatedByName =
    updatedByRole === "admin"
      ? "관리자"
      : sanitizeUserName(note.updatedByName || fallbackUserName, updatedByRole);

  return {
    noteId: String(note.id || uuidv4()),
    x: typeof note.x === "number" ? clamp(note.x, 0.06, 0.94) : 0.14,
    y: typeof note.y === "number" ? clamp(note.y, 0.08, 0.92) : 0.16,
    width: typeof note.width === "number" ? clamp(note.width, 0.12, 0.3) : 0.16,
    height: typeof note.height === "number" ? clamp(note.height, 0.09, 0.28) : 0.1,
    text: String(note.text || "").slice(0, 500),
    color: String(note.color || "#fff7c2"),
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
  if (typeof patch.color === "string") next.color = patch.color;

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
  if (!uri) throw new Error("MONGODB_URI 환경변수가 없습니다.");
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) return;

  await mongoose.connect(uri, { autoIndex: true });
  console.log("[MONGO] connected");
}

async function getMessageHistory(roomId) {
  return Message.find({ roomId }).sort({ time: 1 }).limit(300).lean();
}

async function appendMessage(roomId, message) {
  await Message.create({ roomId, ...message });

  const count = await Message.countDocuments({ roomId });
  if (count > 300) {
    const overflow = count - 300;
    const oldDocs = await Message.find({ roomId })
      .sort({ time: 1 })
      .limit(overflow)
      .select("_id")
      .lean();

    if (oldDocs.length) {
      await Message.deleteMany({ _id: { $in: oldDocs.map((doc) => doc._id) } });
    }
  }
}

async function getDrawingHistory(roomId, imageId) {
  const doc = await Drawing.findOne({ roomId, imageId }).lean();
  return doc?.strokes || [];
}

async function replaceDrawingHistory(roomId, imageId, strokes) {
  const safeStrokes = Array.isArray(strokes) ? strokes.slice(-2000) : [];
  await Drawing.findOneAndUpdate(
    { roomId, imageId },
    { $set: { strokes: safeStrokes } },
    { upsert: true, new: true }
  );
  return safeStrokes;
}

async function appendDrawStroke(roomId, imageId, stroke) {
  const current = await getDrawingHistory(roomId, imageId);
  current.push(stroke);
  return replaceDrawingHistory(roomId, imageId, current);
}

async function appendDrawStrokes(roomId, imageId, strokes) {
  const current = await getDrawingHistory(roomId, imageId);
  current.push(...strokes);
  return replaceDrawingHistory(roomId, imageId, current);
}

async function clearDrawingHistory(roomId, imageId) {
  await Drawing.findOneAndUpdate(
    { roomId, imageId },
    { $set: { strokes: [] } },
    { upsert: true, new: true }
  );
}

async function getNotes(roomId, imageId) {
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

async function addOrGetNote(roomId, imageId, normalized) {
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

  const count = await Note.countDocuments({ roomId, imageId });
  if (count > 100) {
    const overflow = count - 100;
    const oldDocs = await Note.find({ roomId, imageId })
      .sort({ updatedAt: 1 })
      .limit(overflow)
      .select("_id")
      .lean();

    if (oldDocs.length) {
      await Note.deleteMany({ _id: { $in: oldDocs.map((doc) => doc._id) } });
    }
  }

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

async function updateNote(roomId, imageId, noteId, patch) {
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

async function deleteNote(roomId, imageId, noteId) {
  await Note.deleteOne({ roomId, imageId, noteId });
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
        return res.status(400).json({
          error: "업로드 처리 중 오류가 발생했습니다."
        });
      }

      return res.status(400).json({
        error: err.message || "업로드 실패"
      });
    });
  },
  async (req, res) => {
    try {
      if (!hasCloudinaryEnv) {
        return res.status(500).json({ error: "Cloudinary 환경변수가 설정되지 않았습니다." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "파일 없음" });
      }

      const dataUri = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      const uploaded = await cloudinary.uploader.upload(dataUri, {
        folder: "design-chat",
        public_id: `${Date.now()}-${uuidv4()}`,
        resource_type: "image"
      });

      return res.json({
        success: true,
        url: uploaded.secure_url
      });
    } catch (error) {
      console.error("upload error:", error);
      return res.status(500).json({ error: "업로드 실패" });
    }
  }
);

io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  socket.on("join", async (payload = {}, ack) => {
    try {
      const roomId = String(payload.roomId || "").trim();
      if (!roomId) {
        if (ack) ack({ ok: false, error: "roomId 없음" });
        socket.emit("join-error", { ok: false, error: "roomId 없음" });
        return;
      }

      const role = sanitizeRole(payload.role);
      const userName = sanitizeUserName(payload.userName, role);

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.role = role;
      socket.data.userName = userName;

      const history = await getMessageHistory(roomId);
      socket.emit("history", history);

      if (ack) ack({ ok: true, roomId, role, userName });
      socket.emit("joined", { ok: true, roomId, role, userName });
    } catch (error) {
      console.error("join error:", error);
      if (ack) ack({ ok: false, error: "join 오류" });
      socket.emit("join-error", { ok: false, error: "join 오류" });
    }
  });

  socket.on("message", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) {
        if (ack) ack({ ok: false, error: "join 필요" });
        return;
      }

      const text = String(payload.text || "").trim();
      if (!text) {
        if (ack) ack({ ok: false, error: "메시지 없음" });
        return;
      }

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const message = {
        type: "text",
        text,
        sender: role,
        senderName: userName,
        time: Date.now()
      };

      await appendMessage(roomId, message);
      io.to(roomId).emit("message", message);

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("message error:", error);
      if (ack) ack({ ok: false, error: "메시지 오류" });
    }
  });

  socket.on("image", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) {
        if (ack) ack({ ok: false, error: "join 필요" });
        return;
      }

      const imageUrl = String(payload.url || "").trim();
      if (!imageUrl) {
        if (ack) ack({ ok: false, error: "imageUrl 없음" });
        return;
      }

      const imageId = uuidv4();
      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const message = {
        type: "image",
        imageId,
        imageUrl,
        sender: role,
        senderName: userName,
        time: Date.now()
      };

      await appendMessage(roomId, message);
      await replaceDrawingHistory(roomId, imageId, []);
      io.to(roomId).emit("image", message);

      if (ack) ack({ ok: true, imageId, imageUrl });
    } catch (error) {
      console.error("image error:", error);
      if (ack) ack({ ok: false, error: "이미지 오류" });
    }
  });

  socket.on("request-drawing-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const strokes = await getDrawingHistory(roomId, imageId);
      socket.emit("drawing-history", { imageId, strokes });
    } catch (error) {
      console.error("request-drawing-history error:", error);
    }
  });

  socket.on("draw-stroke", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      await appendDrawStroke(roomId, imageId, payload);
      io.to(roomId).emit("draw-stroke", payload);
    } catch (error) {
      console.error("draw-stroke error:", error);
    }
  });

  socket.on("draw-strokes", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
      if (!roomId || !imageId || !strokes.length) return;

      await appendDrawStrokes(roomId, imageId, strokes);
      io.to(roomId).emit("draw-strokes", { imageId, strokes });
    } catch (error) {
      console.error("draw-strokes error:", error);
    }
  });

  socket.on("replace-drawing-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
      if (!roomId || !imageId) return;

      const saved = await replaceDrawingHistory(roomId, imageId, strokes);
      io.to(roomId).emit("drawing-history", { imageId, strokes: saved });
    } catch (error) {
      console.error("replace-drawing-history error:", error);
    }
  });

  socket.on("clear-drawing", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      await clearDrawingHistory(roomId, imageId);
      io.to(roomId).emit("clear-drawing", { imageId });
    } catch (error) {
      console.error("clear-drawing error:", error);
    }
  });

  socket.on("request-note-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const notes = await getNotes(roomId, imageId);
      socket.emit("note-history", { imageId, notes });
    } catch (error) {
      console.error("request-note-history error:", error);
    }
  });

  socket.on("add-note", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const note = payload.note;
      if (!roomId || !imageId || !note) return;

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);
      const normalized = normalizeNote(note, role, userName);
      const saved = await addOrGetNote(roomId, imageId, normalized);

      io.to(roomId).emit("note-added", { imageId, note: saved });
    } catch (error) {
      console.error("add-note error:", error);
    }
  });

  socket.on("note-live-update", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) return;

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);
      const patch = normalizeNotePatch(payload.patch || {}, role, userName);

      const updated = await updateNote(roomId, imageId, noteId, patch);
      if (!updated) return;

      io.to(roomId).emit("note-live-update", {
        imageId,
        noteId,
        patch: {
          x: updated.x,
          y: updated.y,
          width: updated.width,
          height: updated.height,
          text: updated.text,
          color: updated.color,
          updatedAt: updated.updatedAt,
          updatedByRole: updated.updatedByRole,
          updatedByName: updated.updatedByName
        }
      });
    } catch (error) {
      console.error("note-live-update error:", error);
    }
  });

  socket.on("update-note", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) {
        if (ack) ack({ ok: false, error: "필수값 없음" });
        return;
      }

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);
      const patch = normalizeNotePatch(payload.patch || {}, role, userName);

      const updated = await updateNote(roomId, imageId, noteId, patch);
      if (!updated) {
        if (ack) ack({ ok: false, error: "노트를 찾을 수 없음" });
        return;
      }

      io.to(roomId).emit("note-updated", { imageId, note: updated });
      if (ack) ack({ ok: true, note: updated });
    } catch (error) {
      console.error("update-note error:", error);
      if (ack) ack({ ok: false, error: "노트 저장 오류" });
    }
  });

  socket.on("delete-note", async (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) {
        if (ack) ack({ ok: false, error: "필수값 없음" });
        return;
      }

      await deleteNote(roomId, imageId, noteId);
      io.to(roomId).emit("note-deleted", { imageId, noteId });
      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("delete-note error:", error);
      if (ack) ack({ ok: false, error: "노트 삭제 오류" });
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
  });
});

async function bootstrap() {
  try {
    await ensureMongoConnected();
    server.listen(PORT, HOST, () => {
      console.log(`[SERVER] listening on http://${HOST}:${PORT}`);
    });
  } catch (error) {
    console.error("[BOOT] failed:", error);
    process.exit(1);
  }
}

bootstrap();
