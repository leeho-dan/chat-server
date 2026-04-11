const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = new Set();

io.on("connection", socket => {

  /* ===== 입장 ===== */
  socket.on("join", ({ roomId, role }) => {
    socket.join(roomId);

    if(role === "user"){
      rooms.add(roomId);
      io.emit("roomList", Array.from(rooms));
    }
  });

  /* ===== 메시지 ===== */
  socket.on("message", data => {
    if(!data.roomId) return;
    io.to(data.roomId).emit("message", data);
  });

  /* ===== 이미지 ===== */
  socket.on("image", data => {
    if(!data.roomId) return;
    io.to(data.roomId).emit("image", data);
  });

  /* ===== 🎨 그림 (실시간 공유) ===== */
  socket.on("draw", data => {
    if(!data.roomId) return;
    io.to(data.roomId).emit("draw", data);
  });

  /* ===== 💬 코멘트 (실시간 공유) ===== */
  socket.on("comment", data => {
    if(!data.roomId) return;
    io.to(data.roomId).emit("comment", data);
  });

  /* ===== 연결 종료 ===== */
  socket.on("disconnect", () => {
    // 필요 시 방 정리 로직 추가 가능
  });

});

server.listen(3000, ()=>{
  console.log("서버 실행중: http://localhost:3000");
});
