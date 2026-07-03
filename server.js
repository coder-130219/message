// ============================================
//  친구들 채팅 서버 (Node.js + Socket.IO)
//  실행: npm install → npm start
// ============================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ★ 입장 비밀번호 — 친구들에게만 알려주세요!
//   (호스팅 사이트의 환경변수 CHAT_PASSWORD 로도 설정 가능)
const PASSWORD = process.env.CHAT_PASSWORD || "friends123";

// 채널 목록 (내부 이름 — 화면에 보이는 이름은 클라이언트에서 언어별로 번역됨)
const CHANNELS = ["general", "games", "homework"];

// 채널별 최근 메시지 기록 (서버가 켜져 있는 동안만 유지)
const HISTORY_LIMIT = 50;
const history = {};
CHANNELS.forEach((c) => (history[c] = []));

// public 폴더의 웹페이지를 제공
app.use(express.static("public"));

// 특정 채널에 접속 중인 닉네임 목록 만들기
function onlineList(channel) {
  const room = io.sockets.adapter.rooms.get(channel);
  const names = [];
  if (room) {
    for (const id of room) {
      const s = io.sockets.sockets.get(id);
      if (s && s.data.nick) names.push(s.data.nick);
    }
  }
  return names;
}

io.on("connection", (socket) => {
  // ---- 입장 (닉네임 + 비밀번호 확인) ----
  socket.on("join", (data, cb) => {
    if (typeof cb !== "function") return;
    const nick = (data && typeof data.nick === "string" ? data.nick : "").trim();
    const password = data && data.password;

    if (password !== PASSWORD) return cb({ ok: false, error: "bad_password" });
    if (!nick || nick.length > 20) return cb({ ok: false, error: "bad_nick" });

    socket.data.nick = nick;
    socket.data.channel = "general";
    socket.join("general");

    cb({ ok: true, channels: CHANNELS, channel: "general", history: history["general"] });
    io.to("general").emit("system", { type: "join", nick });
    io.to("general").emit("online", onlineList("general"));
  });

  // ---- 채널 이동 ----
  socket.on("switchChannel", (channel, cb) => {
    if (!socket.data.nick || !CHANNELS.includes(channel)) return;
    const old = socket.data.channel;
    socket.leave(old);
    io.to(old).emit("online", onlineList(old));

    socket.join(channel);
    socket.data.channel = channel;
    if (typeof cb === "function") cb({ history: history[channel] });
    io.to(channel).emit("online", onlineList(channel));
  });

  // ---- 메시지 전송 ----
  socket.on("message", (text) => {
    if (!socket.data.nick || typeof text !== "string") return;
    text = text.trim().slice(0, 500); // 최대 500자
    if (!text) return;

    const msg = { nick: socket.data.nick, text, time: Date.now() };
    const ch = socket.data.channel;
    history[ch].push(msg);
    if (history[ch].length > HISTORY_LIMIT) history[ch].shift();

    io.to(ch).emit("message", msg);
  });

  // ---- 접속 종료 ----
  socket.on("disconnect", () => {
    if (socket.data.nick && socket.data.channel) {
      io.to(socket.data.channel).emit("system", { type: "leave", nick: socket.data.nick });
      io.to(socket.data.channel).emit("online", onlineList(socket.data.channel));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("✅ 채팅 서버 실행 중! 포트: " + PORT);
});
