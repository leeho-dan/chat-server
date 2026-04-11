const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let rooms = new Set();

io.on("connection", socket => {

  /* 입장 */
  socket.on("join", ({ roomId, role }) => {
    socket.join(roomId);

    if(role === "user"){
      rooms.add(roomId);
      io.emit("roomList", Array.from(rooms));
    }
  });

  /* 메시지 */
  socket.on("message", data => {
    io.to(data.roomId).emit("message", data);
  });

  /* 이미지 */
  socket.on("image", data => {
    io.to(data.roomId).emit("image", data);
  });

});

server.listen(3000, ()=>{
  console.log("서버 실행중");
});
