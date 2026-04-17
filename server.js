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

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

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
  res.json({ ok: true, uptime: process.uptime() });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

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
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "파일 없음" });
      }

      const originalExt = path.extname(req.file.originalname || "").toLowerCase();
      const safeExt = originalExt || ".png";
      const filename = `${Date.now()}-${uuidv4()}${safeExt}`;
      const filepath = path.join(UPLOAD_DIR, filename);

      fs.writeFileSync(filepath, req.file.buffer);

      return res.json({
        success: true,
        url: `/uploads/${filename}`
      });
    } catch (error) {
      console.error("upload error:", error);
      return res.status(500).json({ error: "업로드 실패" });
    }
  }
);

const rooms = Object.create(null);

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

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      messages: [],
      drawings: Object.create(null),
      notes: Object.create(null)
    };
  }
  return rooms[roomId];
}

function trimMessages(room) {
  if (room.messages.length > 300) {
    room.messages = room.messages.slice(-300);
  }
}

function trimStrokes(room, imageId) {
  room.drawings[imageId] = room.drawings[imageId] || [];
  if (room.drawings[imageId].length > 2000) {
    room.drawings[imageId] = room.drawings[imageId].slice(-2000);
  }
}

function trimNotes(room, imageId) {
  room.notes[imageId] = room.notes[imageId] || [];
  if (room.notes[imageId].length > 100) {
    room.notes[imageId] = room.notes[imageId].slice(-100);
  }
}

function normalizeNote(note = {}, fallbackRole = "user", fallbackUserName = "고객") {
  const updatedByRole = sanitizeRole(note.updatedByRole || fallbackRole);
  const updatedByName =
    updatedByRole === "admin"
      ? "관리자"
      : sanitizeUserName(note.updatedByName || fallbackUserName, updatedByRole);

  return {
    id: String(note.id || uuidv4()),
    x: typeof note.x === "number" ? clamp(note.x, 0.06, 0.94) : 0.14,
    y: typeof note.y === "number" ? clamp(note.y, 0.08, 0.92) : 0.16,
    width: typeof note.width === "number" ? clamp(note.width, 0.12, 0.30) : 0.16,
    height: typeof note.height === "number" ? clamp(note.height, 0.09, 0.28) : 0.10,
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
  if (typeof patch.width === "number") next.width = clamp(patch.width, 0.12, 0.30);
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

io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  socket.on("join", (payload = {}, ack) => {
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

      const room = getRoom(roomId);

      socket.emit("history", room.messages);

      if (ack) {
        ack({ ok: true, roomId, role, userName });
      }
      socket.emit("joined", { ok: true, roomId, role, userName });
    } catch (error) {
      console.error("join error:", error);
      if (ack) ack({ ok: false, error: "join 오류" });
      socket.emit("join-error", { ok: false, error: "join 오류" });
    }
  });

  socket.on("message", (payload = {}, ack) => {
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

      const room = getRoom(roomId);
      room.messages.push(message);
      trimMessages(room);

      io.to(roomId).emit("message", message);

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("message error:", error);
      if (ack) ack({ ok: false, error: "메시지 오류" });
    }
  });

  socket.on("image", (payload = {}, ack) => {
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

      const room = getRoom(roomId);
      room.messages.push(message);
      trimMessages(room);

      room.drawings[imageId] = room.drawings[imageId] || [];
      room.notes[imageId] = room.notes[imageId] || [];

      io.to(roomId).emit("image", message);

      if (ack) ack({ ok: true, imageId, imageUrl });
    } catch (error) {
      console.error("image error:", error);
      if (ack) ack({ ok: false, error: "이미지 오류" });
    }
  });

  socket.on("request-drawing-history", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const room = getRoom(roomId);
      socket.emit("drawing-history", {
        imageId,
        strokes: room.drawings[imageId] || []
      });
    } catch (error) {
      console.error("request-drawing-history error:", error);
    }
  });

  socket.on("draw-stroke", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const room = getRoom(roomId);
      room.drawings[imageId] = room.drawings[imageId] || [];
      room.drawings[imageId].push(payload);
      trimStrokes(room, imageId);

      io.to(roomId).emit("draw-stroke", payload);
    } catch (error) {
      console.error("draw-stroke error:", error);
    }
  });

  socket.on("draw-strokes", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
      if (!roomId || !imageId || !strokes.length) return;

      const room = getRoom(roomId);
      room.drawings[imageId] = room.drawings[imageId] || [];
      room.drawings[imageId].push(...strokes);
      trimStrokes(room, imageId);

      io.to(roomId).emit("draw-strokes", { imageId, strokes });
    } catch (error) {
      console.error("draw-strokes error:", error);
    }
  });

  socket.on("replace-drawing-history", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const strokes = Array.isArray(payload.strokes) ? payload.strokes : [];
      if (!roomId || !imageId) return;

      const room = getRoom(roomId);
      room.drawings[imageId] = strokes.slice(-2000);

      io.to(roomId).emit("drawing-history", {
        imageId,
        strokes: room.drawings[imageId]
      });
    } catch (error) {
      console.error("replace-drawing-history error:", error);
    }
  });

  socket.on("clear-drawing", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const room = getRoom(roomId);
      room.drawings[imageId] = [];

      io.to(roomId).emit("clear-drawing", { imageId });
    } catch (error) {
      console.error("clear-drawing error:", error);
    }
  });

  socket.on("request-note-history", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) return;

      const room = getRoom(roomId);
      socket.emit("note-history", {
        imageId,
        notes: room.notes[imageId] || []
      });
    } catch (error) {
      console.error("request-note-history error:", error);
    }
  });

  socket.on("add-note", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const note = payload.note;
      if (!roomId || !imageId || !note) return;

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const room = getRoom(roomId);
      room.notes[imageId] = room.notes[imageId] || [];

      const normalized = normalizeNote(note, role, userName);
      const exists = room.notes[imageId].some((item) => item.id === normalized.id);

      if (!exists) {
        room.notes[imageId].push(normalized);
        trimNotes(room, imageId);
      }

      io.to(roomId).emit("note-added", { imageId, note: normalized });
    } catch (error) {
      console.error("add-note error:", error);
    }
  });

  socket.on("note-live-update", (payload = {}) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) return;

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const room = getRoom(roomId);
      room.notes[imageId] = room.notes[imageId] || [];

      const note = room.notes[imageId].find((item) => item.id === noteId);
      if (!note) return;

      const patch = normalizeNotePatch(payload.patch || {}, role, userName);
      Object.assign(note, patch);

      io.to(roomId).emit("note-live-update", { imageId, noteId, patch });
    } catch (error) {
      console.error("note-live-update error:", error);
    }
  });

  socket.on("update-note", (payload = {}, ack) => {
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

      const room = getRoom(roomId);
      room.notes[imageId] = room.notes[imageId] || [];

      const note = room.notes[imageId].find((item) => item.id === noteId);
      if (!note) {
        if (ack) ack({ ok: false, error: "메모 없음" });
        return;
      }

      const patch = normalizeNotePatch(payload.patch || {}, role, userName);
      Object.assign(note, patch);

      io.to(roomId).emit("note-updated", { imageId, noteId, patch });

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("update-note error:", error);
      if (ack) ack({ ok: false, error: "메모 수정 오류" });
    }
  });

  socket.on("delete-note", (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const noteId = String(payload.noteId || "").trim();
      if (!roomId || !imageId || !noteId) {
        if (ack) ack({ ok: false, error: "필수값 없음" });
        return;
      }

      const room = getRoom(roomId);
      room.notes[imageId] = room.notes[imageId] || [];
      room.notes[imageId] = room.notes[imageId].filter((item) => item.id !== noteId);

      io.to(roomId).emit("note-deleted", { imageId, noteId });

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("delete-note error:", error);
      if (ack) ack({ ok: false, error: "삭제 오류" });
    }
  });

  socket.on("replace-note-history", (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      const notes = Array.isArray(payload.notes) ? payload.notes : [];
      if (!roomId || !imageId) {
        if (ack) ack({ ok: false, error: "필수값 없음" });
        return;
      }

      const role = sanitizeRole(socket.data.role);
      const userName = sanitizeUserName(socket.data.userName, role);

      const room = getRoom(roomId);
      room.notes[imageId] = notes
        .map((note) => normalizeNote(note, role, userName))
        .slice(-100);

      io.to(roomId).emit("note-history", {
        imageId,
        notes: room.notes[imageId]
      });

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("replace-note-history error:", error);
      if (ack) ack({ ok: false, error: "노트 이력 교체 오류" });
    }
  });

  socket.on("clear-notes", (payload = {}, ack) => {
    try {
      const roomId = socket.data.roomId;
      const imageId = String(payload.imageId || "").trim();
      if (!roomId || !imageId) {
        if (ack) ack({ ok: false, error: "필수값 없음" });
        return;
      }

      const room = getRoom(roomId);
      room.notes[imageId] = [];

      io.to(roomId).emit("clear-notes", { imageId });

      if (ack) ack({ ok: true });
    } catch (error) {
      console.error("clear-notes error:", error);
      if (ack) ack({ ok: false, error: "메모 전체 삭제 오류" });
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("disconnect:", socket.id, reason);
  });
});

process.on("uncaughtException", (error) => {
  console.error("uncaught:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("unhandled:", error);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 121000;

server.listen(PORT, HOST, () => {
  console.log(`server running: http://${HOST}:${PORT}`);
});
