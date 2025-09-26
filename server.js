const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// Create WebSocket server
const wss = new WebSocket.Server({ server, path: "/" });

const rooms = new Map();
const users = new Map();
const connections = new Map();

app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "Server is running" });
});

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function sendToClient(ws, type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function sendToRoom(roomName, type, data, excludeWs = null) {
  const room = rooms.get(roomName);
  if (room) {
    room.users.forEach((user) => {
      const userWs = connections.get(user.id);
      if (
        userWs &&
        userWs !== excludeWs &&
        userWs.readyState === WebSocket.OPEN
      ) {
        sendToClient(userWs, type, data);
      }
    });
  }
}

wss.on("connection", (ws) => {
  const connectionId = generateId();
  connections.set(connectionId, ws);
  console.log(`WebSocket connected: ${connectionId}`);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      const { type, ...payload } = data;

      switch (type) {
        case "create-room":
          handleCreateRoom(ws, connectionId, payload);
          break;

        case "join-room":
          handleJoinRoom(ws, connectionId, payload);
          break;

        case "offer":
          handleOffer(ws, connectionId, payload);
          break;

        case "answer":
          handleAnswer(ws, connectionId, payload);
          break;

        case "ice-candidate":
          handleIceCandidate(ws, connectionId, payload);
          break;

        case "toggle-video":
          handleToggleVideo(ws, connectionId, payload);
          break;

        case "toggle-audio":
          handleToggleAudio(ws, connectionId, payload);
          break;

        case "get-room-info":
          handleGetRoomInfo(ws, payload);
          break;

        default:
          console.log("Unknown message type:", type);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      sendToClient(ws, "error", { message: "Invalid message format" });
    }
  });

  ws.on("close", () => {
    handleDisconnect(connectionId);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

function handleCreateRoom(ws, connectionId, { roomName, userName }) {
  if (rooms.has(roomName)) {
    sendToClient(ws, "room-error", { message: "Room already exists" });
    return;
  }

  // Create new room
  rooms.set(roomName, {
    id: roomName,
    creator: connectionId,
    users: [{ id: connectionId, name: userName }],
    createdAt: new Date(),
  });

  users.set(connectionId, { name: userName, room: roomName });

  sendToClient(ws, "room-created", { roomName, userName });

  console.log(`Room created: ${roomName} by ${userName}`);
}

function handleJoinRoom(ws, connectionId, { roomName, userName }) {
  if (!rooms.has(roomName)) {
    sendToClient(ws, "room-error", { message: "Room does not exist" });
    return;
  }

  const room = rooms.get(roomName);

  // Check if room is full (limit to 2 users for peer-to-peer)
  if (room.users.length >= 2) {
    sendToClient(ws, "room-error", { message: "Room is full" });
    return;
  }

  // Add user to room
  room.users.push({ id: connectionId, name: userName });
  users.set(connectionId, { name: userName, room: roomName });

  // Notify all users in room about new user
  sendToRoom(
    roomName,
    "user-joined",
    {
      userId: connectionId,
      userName: userName,
      users: room.users,
    },
    ws
  );

  // Send confirmation to joining user
  sendToClient(ws, "room-joined", {
    roomName,
    userName,
    users: room.users,
  });

  console.log(`${userName} joined room: ${roomName}`);
}

function handleOffer(ws, connectionId, { offer, roomName }) {
  sendToRoom(roomName, "offer", { offer, from: connectionId }, ws);
}

function handleAnswer(ws, connectionId, { answer, roomName }) {
  sendToRoom(roomName, "answer", { answer, from: connectionId }, ws);
}

function handleIceCandidate(ws, connectionId, { candidate, roomName }) {
  sendToRoom(roomName, "ice-candidate", { candidate, from: connectionId }, ws);
}

function handleToggleVideo(ws, connectionId, { roomName, enabled }) {
  sendToRoom(
    roomName,
    "user-video-toggle",
    {
      userId: connectionId,
      enabled,
    },
    ws
  );
}

function handleToggleAudio(ws, connectionId, { roomName, enabled }) {
  sendToRoom(
    roomName,
    "user-audio-toggle",
    {
      userId: connectionId,
      enabled,
    },
    ws
  );
}

function handleGetRoomInfo(ws, roomName) {
  const room = rooms.get(roomName);
  if (room) {
    sendToClient(ws, "room-info", {
      exists: true,
      userCount: room.users.length,
      maxUsers: 2,
    });
  } else {
    sendToClient(ws, "room-info", { exists: false });
  }
}

function handleDisconnect(connectionId) {
  console.log(`WebSocket disconnected: ${connectionId}`);

  const user = users.get(connectionId);
  if (user && user.room) {
    const room = rooms.get(user.room);
    if (room) {
      // Remove user from room
      room.users = room.users.filter((u) => u.id !== connectionId);

      // Notify other users
      sendToRoom(user.room, "user-left", {
        userId: connectionId,
        userName: user.name,
        users: room.users,
      });

      // Delete room if empty
      if (room.users.length === 0) {
        rooms.delete(user.room);
        console.log(`Room deleted: ${user.room}`);
      }
    }
  }

  users.delete(connectionId);
  connections.delete(connectionId);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server is ready`);
});
