const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));

/* ===== MongoDB ===== */
mongoose.connect("여기에_MongoDB_URL");

const MessageSchema = new mongoose.Schema({
  roomId: String,
  text: String,
  sender: String,
  time: Number,
  image: String
});

const Message = mongoose.model("Message", MessageSchema);

/* ===== Cloudinary ===== */
cloudinary.config({
  cloud_name: "여기에_NAME",
  api_key: "여기에_KEY",
  api_secret: "여기에_SECRET"
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "chat",
    allowed_formats: ["jpg", "png", "jpeg"]
  }
});

const upload = multer({ storage });

/* ===== 업로드 ===== */
app.post("/upload", upload.single("image"), (req, res) => {
  res.json({ url: req.file.path });
});

/* ===== 소켓 ===== */
io.on("connection", (socket) => {

  let currentRoom = null;
  let currentRole = null;

  socket.on("join", async ({ roomId, role }) => {
    currentRoom = roomId;
    currentRole = role;

    socket.join(roomId);

    const history = await Message.find({ roomId }).sort({ time: 1 });
    socket.emit("history", history);
  });

  socket.on("message", async (data) => {
    if (!data.text) return;

    const msg = {
      roomId: currentRoom,
      text: data.text,
      sender: currentRole,
      time: Date.now()
    };

    await Message.create(msg);
    io.to(currentRoom).emit("message", msg);
  });

  socket.on("image", async (data) => {
    const msg = {
      roomId: currentRoom,
      image: data.url,
      sender: currentRole,
      time: Date.now()
    };

    await Message.create(msg);
    io.to(currentRoom).emit("image", msg);
  });

});

server.listen(3000, () => {
  console.log("🚀 서버 실행");
});
