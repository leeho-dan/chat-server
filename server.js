const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const mongoose = require("mongoose");
const twilio = require("twilio");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static("public"));
app.use(express.json());

/* ===== 환경변수 ===== */
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

/* ===== MongoDB (안전 연결) ===== */
if (MONGO_URI && MONGO_URI.startsWith("mongodb")) {
  mongoose.connect(MONGO_URI)
    .then(()=>console.log("✅ MongoDB 연결 성공"))
    .catch(err=>console.log("❌ MongoDB 실패:", err.message));
} else {
  console.log("⚠️ MongoDB 연결 생략 (환경변수 없음)");
}

const Message = mongoose.model("Message", new mongoose.Schema({
  roomId:String,
  text:String,
  sender:String,
  time:Number,
  image:String
}));

const User = mongoose.model("User", new mongoose.Schema({
  roomId:String,
  phone:String
}));

/* ===== Cloudinary ===== */
cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: CLOUD_KEY,
  api_secret: CLOUD_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: "chat" }
});

const upload = multer({ storage });

app.post("/upload", upload.single("image"), (req,res)=>{
  try{
    res.json({ url:req.file.path });
  }catch{
    res.status(500).json({ error:"upload 실패" });
  }
});

/* ===== Twilio ===== */
let smsClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  smsClient = twilio(TWILIO_SID, TWILIO_TOKEN);
}

/* ===== 전화번호 등록 ===== */
app.post("/register", async (req,res)=>{
  try{
    const { roomId, phone } = req.body;

    await User.findOneAndUpdate(
      { roomId },
      { phone },
      { upsert:true }
    );

    res.json({ success:true });
  }catch{
    res.status(500).json({ error:"등록 실패" });
  }
});

/* ===== 소켓 ===== */
io.on("connection",(socket)=>{

  let currentRoom = null;
  let currentRole = null;

  socket.on("join", async ({roomId,role})=>{
    currentRoom = roomId;
    currentRole = role;

    socket.join(roomId);

    try{
      const history = await Message.find({roomId}).sort({time:1});
      socket.emit("history",history);
    }catch{}
  });

  socket.on("message", async (data)=>{
    if(!data.text) return;

    const msg={
      roomId:currentRoom,
      text:data.text,
      sender:currentRole,
      time:Date.now()
    };

    try{
      await Message.create(msg);
    }catch{}

    io.to(currentRoom).emit("message",msg);

    /* SMS */
    if(smsClient){
      try{
        if(currentRole==="user"){
          await smsClient.messages.create({
            body:`고객 메시지: ${data.text}`,
            from:TWILIO_NUMBER,
            to:ADMIN_PHONE
          });
        }

        if(currentRole==="admin"){
          const user = await User.findOne({ roomId:currentRoom });

          if(user?.phone){
            await smsClient.messages.create({
              body:`관리자 답변: ${data.text}`,
              from:TWILIO_NUMBER,
              to:user.phone
            });
          }
        }
      }catch(e){
        console.log("SMS 실패:", e.message);
      }
    }

  });

  socket.on("image", async (data)=>{
    const msg={
      roomId:currentRoom,
      image:data.url,
      sender:currentRole,
      time:Date.now()
    };

    try{
      await Message.create(msg);
    }catch{}

    io.to(currentRoom).emit("image",msg);
  });

});

server.listen(PORT, ()=>{
  console.log("🚀 서버 실행:", PORT);
});
