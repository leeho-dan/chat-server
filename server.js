const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const mongoose = require("mongoose");
const twilio = require("twilio");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

/* =========================
   기본 설정
========================= */
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   Socket.IO
========================= */
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

/* =========================
   환경변수
========================= */
const {
  MONGO_URI,
  CLOUD_NAME,
  CLOUD_KEY,
  CLOUD_SECRET,
  TWILIO_SID,
  TWILIO_TOKEN,
  TWILIO_NUMBER,
  ADMIN_PHONE
} = process.env;

/* =========================
   MongoDB
========================= */
let dbReady = false;

mongoose.set("strictQuery", true);

if (MONGO_URI && (MONGO_URI.startsWith("mongodb://") || MONGO_URI.startsWith("mongodb+srv://"))) {
  mongoose.connect(MONGO_URI)
    .then(() => {
      dbReady = true;
      console.log("✅ MongoDB 연결 성공");
    })
    .catch((err) => {
      dbReady = false;
      console.log("❌ MongoDB 실패:", err.message);
    });
} else {
  console.log("⚠️ MONGO_URI 없음 또는 형식 오류. DB 없이 서버만 실행합니다.");
}

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    text: { type: String, default: "" },
    image: { type: String, default: "" },
    sender: { type: String, enum: ["admin", "user", "system"], required: true },
    time: { type: Number, required: true }
  },
  { versionKey: false }
);

const userSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: "" }
  },
  { versionKey: false }
);

const Message = mongoose.model("Message", messageSchema);
const User = mongoose.model("User", userSchema);

/* =========================
   Cloudinary
========================= */
let upload = null;

if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_KEY,
    api_secret: CLOUD_SECRET
  });

  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      return {
        folder: "chat",
        allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
        resource_type: "image"
      };
    }
  });

  upload = multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        return cb(new Error("이미지 파일만 업로드할 수 있습니다."));
      }
      cb(null, true);
    }
  });
} else {
  console.log("⚠️ Cloudinary 환경변수 없음. 이미지 업로드 비활성화");
}

app.post("/upload", (req, res, next) => {
  if (!upload) {
    return res.status(503).json({ error: "이미지 업로드가 아직 설정되지 않았습니다." });
  }
  next();
}, (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "업로드 실패" });
    }
    next();
  });
}, (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "업로드된 파일이 없습니다." });
    }

    return res.json({ url: req.file.path });
  } catch (error) {
    return res.status(500).json({ error: "업로드 처리 중 오류가 발생했습니다." });
  }
});

/* =========================
   Twilio
========================= */
let smsClient = null;

if (TWILIO_SID && TWILIO_TOKEN && TWILIO_NUMBER) {
  smsClient = twilio(TWILIO_SID, TWILIO_TOKEN);
} else {
  console.log("⚠️ Twilio 환경변수 없음. 문자 알림 비활성화");
}

async function sendSmsSafe(to, body) {
  try {
    if (!smsClient || !to || !body) return;
    await smsClient.messages.create({
      body,
      from: TWILIO_NUMBER,
      to
    });
  } catch (error) {
    console.log("SMS 실패:", error.message);
  }
}

/* =========================
   API
========================= */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    dbReady,
    uploadReady: Boolean(upload),
    smsReady: Boolean(smsClient)
  });
});

app.post("/register", async (req, res) => {
  try {
    const { roomId, phone } = req.body || {};

    if (!roomId || typeof roomId !== "string") {
      return res.status(400).json({ error: "roomId가 필요합니다." });
    }

    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "전화번호가 필요합니다." });
    }

    if (!dbReady) {
      return res.status(503).json({ error: "데이터베이스가 아직 연결되지 않았습니다." });
    }

    await User.findOneAndUpdate(
      { roomId },
      { phone: phone.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "전화번호 등록에 실패했습니다." });
  }
});

/* =========================
   메모리 보조 저장
   - DB 미연결 시 최소 동작 보장
========================= */
const memoryMessages = new Map(); // roomId -> []
function pushMemoryMessage(roomId, message) {
  if (!memoryMessages.has(roomId)) {
    memoryMessages.set(roomId, []);
  }
  const list = memoryMessages.get(roomId);
  list.push(message);
  if (list.length > 100) {
    list.shift();
  }
}

/* =========================
   Socket
========================= */
io.on("connection", (socket) => {
  let currentRoom = null;
  let currentRole = "user";

  socket.on("join", async (payload) => {
    try {
      const roomId = payload?.roomId;
      const role = payload?.role;

      if (!roomId || typeof roomId !== "string") return;

      currentRoom = roomId;
      currentRole = role === "admin" ? "admin" : "user";

      socket.join(currentRoom);

      if (dbReady) {
        const history = await Message.find({ roomId: currentRoom }).sort({ time: 1 }).lean();
        socket.emit("history", history);
      } else {
        socket.emit("history", memoryMessages.get(currentRoom) || []);
      }
    } catch (error) {
      console.log("join error:", error.message);
    }
  });

  socket.on("message", async (payload) => {
    try {
      const text = String(payload?.text || "").trim();
      if (!currentRoom || !text) return;

      const msg = {
        roomId: currentRoom,
        text: text.slice(0, 2000),
        image: "",
        sender: currentRole,
        time: Date.now()
      };

      if (dbReady) {
        await Message.create(msg);
      } else {
        pushMemoryMessage(currentRoom, msg);
      }

      io.to(currentRoom).emit("message", msg);

      if (currentRole === "user" && ADMIN_PHONE) {
        await sendSmsSafe(ADMIN_PHONE, `[새 상담] ${msg.text}`);
      }

      if (currentRole === "admin" && dbReady) {
        const user = await User.findOne({ roomId: currentRoom }).lean();
        if (user?.phone) {
          await sendSmsSafe(user.phone, `[관리자 답변] ${msg.text}`);
        }
      }
    } catch (error) {
      console.log("message error:", error.message);
    }
  });

  socket.on("image", async (payload) => {
    try {
      const url = String(payload?.url || "").trim();
      if (!currentRoom || !url) return;

      const msg = {
        roomId: currentRoom,
        text: "",
        image: url,
        sender: currentRole,
        time: Date.now()
      };

      if (dbReady) {
        await Message.create(msg);
      } else {
        pushMemoryMessage(currentRoom, msg);
      }

      io.to(currentRoom).emit("image", msg);

      if (currentRole === "user" && ADMIN_PHONE) {
        await sendSmsSafe(ADMIN_PHONE, "[새 상담] 고객이 이미지를 보냈습니다.");
      }

      if (currentRole === "admin" && dbReady) {
        const user = await User.findOne({ roomId: currentRoom }).lean();
        if (user?.phone) {
          await sendSmsSafe(user.phone, "[관리자 답변] 관리자가 이미지를 보냈습니다.");
        }
      }
    } catch (error) {
      console.log("image error:", error.message);
    }
  });

  socket.on("disconnect", () => {
    // 현재 버전에서는 별도 정리 로직 불필요
  });
});

/* =========================
   시작
========================= */
server.listen(PORT, () => {
  console.log(`🚀 서버 실행: ${PORT}`);
});
