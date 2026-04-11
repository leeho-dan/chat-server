const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(express.static("public"));

/* ===== 방 관리 ===== */
const rooms = new Map(); // roomId -> Set(socketId)

/* ===== 연결 ===== */
io.on("connection", (socket) => {

  let currentRoom = null;
  let currentRole = null;

  /* ===== 입장 ===== */
  socket.on("join", ({ roomId, role }) => {
    if (!roomId) return;

    currentRoom = roomId;
    currentRole = role || "user";

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    console.log(`JOIN: ${socket.id} → ${roomId} (${currentRole})`);
  });

  /* ===== 메시지 ===== */
  socket.on("message", (data) => {
    if (!data || !data.roomId || !data.text) return;

    const safeData = {
      roomId: data.roomId,
      text: String(data.text).slice(0, 1000),
      sender: currentRole, // 서버 기준
      time: Date.now()
    };

    io.to(data.roomId).emit("message", safeData);
  });

  /* ===== 이미지 ===== */
  socket.on("image", (data) => {
    if (!data || !data.roomId || !data.url) return;

    const safeData = {
      roomId: data.roomId,
      url: data.url,
      sender: currentRole,
      time: Date.now()
    };

    io.to(data.roomId).emit("image", safeData);
  });

  /* ===== 🎨 draw (최적화) ===== */
  socket.on("draw", (data) => {
    if (!data || !data.roomId) return;

    // 최소 데이터만 전달
    io.to(data.roomId).emit("draw", {
      last: data.last,
      cur: data.cur
    });
  });

  /* ===== 💬 코멘트 ===== */
  socket.on("comment", (data) => {
    if (!data || !data.roomId || !data.text) return;

    io.to(data.roomId).emit("comment", {
      text: data.text,
      sender: currentRole,
      time: Date.now()
    });
  });

  /* ===== 연결 종료 ===== */
  socket.on("disconnect", () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (room) {
      room.delete(socket.id);

      // 방 비었으면 삭제
      if (room.size === 0) {
        rooms.delete(currentRoom);
        console.log(`ROOM REMOVED: ${currentRoom}`);
      }
    }

    console.log(`DISCONNECT: ${socket.id}`);
  });

});

/* ===== 서버 실행 ===== */
server.listen(3000, () => {
  console.log("🚀 서버 실행: http://localhost:3000");
});
