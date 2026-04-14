const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

/**
 * ----------------------------------------
 * 환경 변수
 * ----------------------------------------
 */
const {
  PORT = 3000,
  MONGODB_URI,
  CLOUD_NAME,
  CLOUD_KEY,
  CLOUD_SECRET,
  TWILIO_SID,
  TWILIO_TOKEN,
  TWILIO_NUMBER,
  ADMIN_PHONE
} = process.env;

/**
 * ----------------------------------------
 * Express / HTTP / Socket.IO
 * ----------------------------------------
 */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/**
 * ----------------------------------------
 * Cloudinary 설정
 * ----------------------------------------
 */
const hasCloudinary =
  Boolean(CLOUD_NAME) &&
  Boolean(CLOUD_KEY) &&
  Boolean(CLOUD_SECRET);

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_KEY,
    api_secret: CLOUD_SECRET
  });
  console.log("✅ Cloudinary configured");
} else {
  console.log("⚠️ Cloudinary env not fully configured. Falling back to local uploads.");
}

/**
 * ----------------------------------------
 * MongoDB 설정
 * ----------------------------------------
 */
let isMongoConnected = false;

mongoose.set("strictQuery", true);

const MessageSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["text", "image"], required: true },
    text: { type: String, default: "" },
    imageId: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    sender: { type: String, enum: ["user", "admin"], default: "user" },
    time: { type: Number, default: () => Date.now() }
  },
  { _id: false }
);

const ImageStateSchema = new mongoose.Schema(
  {
    imageId: { type: String, required: true },
    imageUrl: { type: String, default: "" },
    strokes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notes: { type: [mongoose.Schema.Types.Mixed], default: [] }
  },
  { _id: false }
);

const ContactSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "admin"], default: "user" },
    phone: { type: String, required: true },
    savedAt: { type: Number, default: () => Date.now() }
  },
  { _id: false }
);

const RoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    messages: { type: [MessageSchema], default: [] },
    images: { type: [ImageStateSchema], default: [] },
    contacts: { type: [ContactSchema], default: [] }
  },
  { timestamps: true }
);

const RoomModel = mongoose.model("Room", RoomSchema);

/**
 * ----------------------------------------
 * 메모리 캐시
 * ----------------------------------------
 */
const roomCache = new Map();
const roomSaveTimers = new Map();

function createEmptyRoomState(roomId) {
  return {
    roomId,
    messages: [],
    images: [],
    contacts: []
  };
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function sanitizeRole(role) {
  return role === "admin" ? "admin" : "user";
}

function sanitizeText(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function sanitizePhone(value) {
  return String(value || "").trim().slice(0, 40);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizePoint(point = {}) {
  return {
    x: typeof point.x === "number" ? clamp(point.x, 0, 1) : 0,
    y: typeof point.y === "number" ? clamp(point.y, 0, 1) : 0
  };
}

function sanitizeStroke(raw = {}) {
  return {
    imageId: String(raw.imageId || ""),
    mode: raw.mode === "erase" ? "erase" : "draw",
    color: typeof raw.color === "string" ? raw.color : "#ff3b30",
    size: typeof raw.size === "number" ? clamp(raw.size, 1, 48) : 3,
    last: sanitizePoint(raw.last),
    current: sanitizePoint(raw.current)
  };
}

function sanitizeNote(raw = {}) {
  return {
    id: String(raw.id || uuidv4()),
    x: typeof raw.x === "number" ? clamp(raw.x, 0.06, 0.94) : 0.14,
    y: typeof raw.y === "number" ? clamp(raw.y, 0.08, 0.92) : 0.16,
    width: typeof raw.width === "number" ? clamp(raw.width, 0.12, 0.30) : 0.16,
    height: typeof raw.height === "number" ? clamp(raw.height, 0.09, 0.28) : 0.10,
    text: String(raw.text || "").slice(0, 500),
    color: typeof raw.color === "string" ? raw.color : "#fff7c2",
    author: sanitizeRole(raw.author),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now()
  };
}

function sanitizeNotePatch(raw = {}) {
  const patch = {};

  if (typeof raw.x === "number") patch.x = clamp(raw.x, 0.06, 0.94);
  if (typeof raw.y === "number") patch.y = clamp(raw.y, 0.08, 0.92);
  if (typeof raw.width === "number") patch.width = clamp(raw.width, 0.12, 0.30);
  if (typeof raw.height === "number") patch.height = clamp(raw.height, 0.09, 0.28);
  if (typeof raw.text === "string") patch.text = raw.text.slice(0, 500);
  if (typeof raw.color === "string") patch.color = raw.color;
  patch.updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

  return patch;
}

function getImageState(room, imageId, imageUrl = "") {
  let imageState = room.images.find((img) => img.imageId === imageId);
  if (!imageState) {
    imageState = {
      imageId,
      imageUrl,
      strokes: [],
      notes: []
    };
    room.images.push(imageState);
  } else if (imageUrl && !imageState.imageUrl) {
    imageState.imageUrl = imageUrl;
  }
  return imageState;
}

async function loadRoom(roomId) {
  if (roomCache.has(roomId)) {
    return roomCache.get(roomId);
  }

  let roomState = createEmptyRoomState(roomId);

  if (isMongoConnected) {
    const doc = await RoomModel.findOne({ roomId }).lean();
    if (doc) {
      roomState = {
        roomId: doc.roomId,
        messages: Array.isArray(doc.messages) ? doc.messages : [],
        images: Array.isArray(doc.images) ? doc.images : [],
        contacts: Array.isArray(doc.contacts) ? doc.contacts : []
      };
    }
  }

  roomCache.set(roomId, roomState);
  return roomState;
}

async function saveRoomNow(roomId) {
  const room = roomCache.get(roomId);
  if (!room || !isMongoConnected) return;

  await RoomModel.findOneAndUpdate(
    { roomId },
    {
      roomId,
      messages: room.messages,
      images: room.images,
      contacts: room.contacts
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

function scheduleRoomSave(roomId, delay = 250) {
  if (!isMongoConnected) return;

  const prevTimer = roomSaveTimers.get(roomId);
  if (prevTimer) {
    clearTimeout(prevTimer);
  }

  const timer = setTimeout(async () => {
    try {
      await saveRoomNow(roomId);
    } catch (error) {
      console.error(`saveRoom error [${roomId}]`, error);
    } finally {
      roomSaveTimers.delete(roomId);
    }
  }, delay);

  roomSaveTimers.set(roomId, timer);
}

/**
 * ----------------------------------------
 * Twilio SMS (패키지 없이 fetch 사용)
 * ----------------------------------------
 */
async function sendTwilioSms(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_NUMBER || !to) return;

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", TWILIO_NUMBER);
  form.set("Body", body);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio error: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * ----------------------------------------
 * 업로드
 * ----------------------------------------
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter(req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("이미지 파일만 업로드할 수 있습니다."));
    }
    cb(null, true);
  }
});

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "업로드된 이미지가 없습니다." });
    }

    if (hasCloudinary) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "realtime-design-chat",
            resource_type: "image"
          },
          (error, uploaded) => {
            if (error) return reject(error);
            resolve(uploaded);
          }
        );

        stream.end(req.file.buffer);
      });

      return res.json({
        success: true,
        url: result.secure_url
      });
    }

    const ext = path.extname(req.file.originalname || "").toLowerCase() || ".png";
    const fileName = `${Date.now()}-${uuidv4()}${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    fs.writeFileSync(filePath, req.file.buffer);

    return res.json({
      success: true,
      url: `/uploads/${fileName}`
    });
  } catch (error) {
    console.error("upload error:", error);
    return res.status(500).json({ error: "이미지 업로드 중 오류가 발생했습니다." });
  }
});

/**
 * ----------------------------------------
 * 연락처 저장
 * ----------------------------------------
 */
app.post("/contact", async (req, res) => {
  try {
    const roomId = String(req.body.roomId || "").trim();
    const role = sanitizeRole(req.body.role);
    const phone = sanitizePhone(req.body.phone);

    if (!roomId) {
      return res.status(400).json({ error: "roomId가 필요합니다." });
    }

    if (!phone) {
      return res.status(400).json({ error: "전화번호를 입력해주세요." });
    }

    const room = await loadRoom(roomId);
    const savedAt = Date.now();

    room.contacts.push({
      role,
      phone,
      savedAt
    });

    scheduleRoomSave(roomId);

    if (ADMIN_PHONE && TWILIO_SID && TWILIO_TOKEN && TWILIO_NUMBER) {
      try {
        await sendTwilioSms(
          ADMIN_PHONE,
          `[디자인상담] 연락처 등록\nroom: ${roomId}\nrole: ${role}\nphone: ${phone}`
        );
      } catch (smsError) {
        console.error("Twilio notify error:", smsError.message);
      }
    }

    return res.json({
      success: true,
      roomId,
      role,
      phone,
      savedAt
    });
  } catch (error) {
    console.error("contact error:", error);
    return res.status(500).json({ error: "연락처 저장 중 오류가 발생했습니다." });
  }
});

/**
 * ----------------------------------------
 * Socket.IO
 * ----------------------------------------
 */
io.on("connection", (socket) => {
  console.log("client connected:", socket.id);

  socket.on("join", async (payload = {}) => {
    try {
      const roomId = String(payload.roomId || "").trim();
      const role = sanitizeRole(payload.role);

      if (!roomId) return;

      socket.data.roomId = roomId;
      socket.data.role = role;

      socket.join(roomId);

      const room = await loadRoom(roomId);
      socket.emit("history", clone(room.messages));

      console.log(`socket ${socket.id} joined room ${roomId} as ${role}`);
    } catch (error) {
      console.error("join error:", error);
    }
  });

  socket.on("message", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const sender = sanitizeRole(socket.data.role);
      if (!roomId) return;

      const text = sanitizeText(payload.text, 3000);
      if (!text) return;

      const room = await loadRoom(roomId);
      const message = {
        type: "text",
        text,
        sender,
        time: Date.now()
      };

      room.messages.push(message);
      scheduleRoomSave(roomId);
      io.to(roomId).emit("message", message);
    } catch (error) {
      console.error("message error:", error);
    }
  });

  socket.on("image", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const sender = sanitizeRole(socket.data.role);
      if (!roomId) return;

      const imageUrl = String(payload.url || payload.imageUrl || "").trim();
      if (!imageUrl) return;

      const room = await loadRoom(roomId);
      const imageId = uuidv4();

      getImageState(room, imageId, imageUrl);

      const message = {
        type: "image",
        imageId,
        imageUrl,
        sender,
        time: Date.now()
      };

      room.messages.push(message);
      scheduleRoomSave(roomId);
      io.to(roomId).emit("image", message);
    } catch (error) {
      console.error("image error:", error);
    }
  });

  socket.on("request-drawing-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      socket.emit("drawing-history", {
        imageId,
        strokes: clone(imageState.strokes)
      });
    } catch (error) {
      console.error("request-drawing-history error:", error);
    }
  });

  socket.on("draw-stroke", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);
      const stroke = sanitizeStroke(payload);

      imageState.strokes.push(stroke);
      scheduleRoomSave(roomId);
      io.to(roomId).emit("draw-stroke", stroke);
    } catch (error) {
      console.error("draw-stroke error:", error);
    }
  });

  socket.on("draw-strokes", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);
      const strokes = Array.isArray(payload.strokes)
        ? payload.strokes.map(sanitizeStroke)
        : [];

      imageState.strokes.push(...strokes);
      scheduleRoomSave(roomId);

      io.to(roomId).emit("draw-strokes", {
        imageId,
        strokes
      });
    } catch (error) {
      console.error("draw-strokes error:", error);
    }
  });

  socket.on("replace-drawing-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      imageState.strokes = Array.isArray(payload.strokes)
        ? payload.strokes.map(sanitizeStroke)
        : [];

      scheduleRoomSave(roomId);

      io.to(roomId).emit("drawing-history", {
        imageId,
        strokes: clone(imageState.strokes)
      });
    } catch (error) {
      console.error("replace-drawing-history error:", error);
    }
  });

  socket.on("clear-drawing", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      imageState.strokes = [];
      scheduleRoomSave(roomId);

      io.to(roomId).emit("clear-drawing", { imageId });
    } catch (error) {
      console.error("clear-drawing error:", error);
    }
  });

  socket.on("request-note-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      socket.emit("note-history", {
        imageId,
        notes: clone(imageState.notes)
      });
    } catch (error) {
      console.error("request-note-history error:", error);
    }
  });

  socket.on("add-note", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId || !payload.note) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);
      const note = sanitizeNote(payload.note);

      const exists = imageState.notes.some((item) => item.id === note.id);
      if (!exists) {
        imageState.notes.push(note);
        scheduleRoomSave(roomId);
      }

      io.to(roomId).emit("note-added", {
        imageId,
        note
      });
    } catch (error) {
      console.error("add-note error:", error);
    }
  });

  socket.on("note-live-update", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!imageId || !noteId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);
      const note = imageState.notes.find((item) => item.id === noteId);
      if (!note) return;

      const patch = sanitizeNotePatch(payload.patch || {});
      Object.assign(note, patch);

      io.to(roomId).emit("note-live-update", {
        imageId,
        noteId,
        patch
      });
    } catch (error) {
      console.error("note-live-update error:", error);
    }
  });

  socket.on("update-note", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!imageId || !noteId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);
      const note = imageState.notes.find((item) => item.id === noteId);
      if (!note) return;

      const patch = sanitizeNotePatch(payload.patch || {});
      Object.assign(note, patch);

      scheduleRoomSave(roomId);

      io.to(roomId).emit("note-updated", {
        imageId,
        noteId,
        patch
      });
    } catch (error) {
      console.error("update-note error:", error);
    }
  });

  socket.on("delete-note", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!imageId || !noteId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      imageState.notes = imageState.notes.filter((item) => item.id !== noteId);
      scheduleRoomSave(roomId);

      io.to(roomId).emit("note-deleted", {
        imageId,
        noteId
      });
    } catch (error) {
      console.error("delete-note error:", error);
    }
  });

  socket.on("replace-note-history", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      imageState.notes = Array.isArray(payload.notes)
        ? payload.notes.map(sanitizeNote)
        : [];

      scheduleRoomSave(roomId);

      io.to(roomId).emit("note-history", {
        imageId,
        notes: clone(imageState.notes)
      });
    } catch (error) {
      console.error("replace-note-history error:", error);
    }
  });

  socket.on("clear-notes", async (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      const imageId = String(payload.imageId || "").trim();
      if (!imageId) return;

      const room = await loadRoom(roomId);
      const imageState = getImageState(room, imageId);

      imageState.notes = [];
      scheduleRoomSave(roomId);

      io.to(roomId).emit("clear-notes", { imageId });
    } catch (error) {
      console.error("clear-notes error:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);
  });
});

/**
 * ----------------------------------------
 * 에러 핸들링
 * ----------------------------------------
 */
app.use((error, req, res, next) => {
  console.error("Unhandled express error:", error);
  res.status(500).json({
    error: error.message || "서버 오류가 발생했습니다."
  });
});

/**
 * ----------------------------------------
 * 서버 시작
 * ----------------------------------------
 */
async function start() {
  try {
    if (MONGODB_URI) {
      await mongoose.connect(MONGODB_URI);
      isMongoConnected = true;
      console.log("✅ MongoDB connected");
    } else {
      console.log("⚠️ MONGODB_URI not set. Running without DB persistence.");
    }

    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server start error:", error);
    process.exit(1);
  }
}

start();
