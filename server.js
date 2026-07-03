// ============================================
//  친구들 채팅 서버 v2 — 채널 + 개인 메시지(DM)
//  실행: npm install → npm start
// ============================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ★ 입장 비밀번호 — 친구들에게만 알려주세요!
const PASSWORD = process.env.CHAT_PASSWORD || "friends123";

const CHANNELS = ["general", "games", "homework"];
const HISTORY_LIMIT = 50;

// 채널별 메시지 기록
const history = {};
CHANNELS.forEach((c) => (history[c] = []));

// DM 기록 — 키는 두 닉네임을 정렬해서 합친 것 (예: "민준|유나")
const dmHistory = {};
function dmKey(a, b) {
  return [a, b].sort().join("|");
}

// 현재 접속 중인 사용자: 닉네임 → 소켓 ID
const users = new Map();

app.use(express.static("public"));

// 전체 접속자 목록을 모두에게 알림
function broadcastOnline() {
  io.emit("online", [...users.keys()]);
}

io.on("connection", (socket) => {
  // ---- 입장 (닉네임 + 비밀번호 확인) ----
  socket.on("join", (data, cb) => {
    if (typeof cb !== "function") return;
    const nick = (data && typeof data.nick === "string" ? data.nick : "").trim();
    const password = data && data.password;

    if (password !== PASSWORD) return cb({ ok: false, error: "bad_password" });
    if (!nick || nick.length > 20) return cb({ ok: false, error: "bad_nick" });
    if (users.has(nick)) return cb({ ok: false, error: "nick_taken" }); // 닉네임 중복 금지

    socket.data.nick = nick;
    socket.data.channel = "general";
    users.set(nick, socket.id);
    socket.join("general");

    cb({ ok: true, channels: CHANNELS, channel: "general", history: history["general"] });
    io.to("general").emit("system", { type: "join", nick });
    broadcastOnline();
  });

  // ---- 채널 이동 ----
  socket.on("switchChannel", (channel, cb) => {
    if (!socket.data.nick || !CHANNELS.includes(channel)) return;
    socket.leave(socket.data.channel);
    socket.join(channel);
    socket.data.channel = channel;
    if (typeof cb === "function") cb({ history: history[channel] });
  });

  // ---- 채널 메시지 ----
  socket.on("message", (text) => {
    if (!socket.data.nick || typeof text !== "string") return;
    text = text.trim().slice(0, 500);
    if (!text) return;

    const msg = { nick: socket.data.nick, text, time: Date.now() };
    const ch = socket.data.channel;
    history[ch].push(msg);
    if (history[ch].length > HISTORY_LIMIT) history[ch].shift();
    io.to(ch).emit("message", msg);
  });

  // ---- 개인 메시지 (DM) ----
  socket.on("dm", (data, cb) => {
    if (!socket.data.nick) return;
    const to = data && typeof data.to === "string" ? data.to : "";
    let text = data && typeof data.text === "string" ? data.text : "";
    text = text.trim().slice(0, 500);
    if (!to || !text || to === socket.data.nick) return;

    const msg = { from: socket.data.nick, to, text, time: Date.now() };

    // 기록 저장 (상대가 오프라인이어도 저장 → 다시 들어오면 볼 수 있음)
    const key = dmKey(socket.data.nick, to);
    if (!dmHistory[key]) dmHistory[key] = [];
    dmHistory[key].push(msg);
    if (dmHistory[key].length > HISTORY_LIMIT) dmHistory[key].shift();

    // 나에게 + 상대에게 전달
    socket.emit("dm", msg);
    const targetId = users.get(to);
    if (targetId) {
      io.to(targetId).emit("dm", msg);
      if (typeof cb === "function") cb({ delivered: true });
    } else {
      if (typeof cb === "function") cb({ delivered: false }); // 상대 오프라인
    }
  });

  // ---- DM 대화 기록 불러오기 ----
  socket.on("openDm", (other, cb) => {
    if (!socket.data.nick || typeof other !== "string" || typeof cb !== "function") return;
    cb({ history: dmHistory[dmKey(socket.data.nick, other)] || [] });
  });

  // ---- 접속 종료 ----
  socket.on("disconnect", () => {
    if (socket.data.nick) {
      users.delete(socket.data.nick);
      io.to(socket.data.channel).emit("system", { type: "leave", nick: socket.data.nick });
      broadcastOnline();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("✅ 채팅 서버 실행 중! 포트: " + PORT);
});
