"# subset-backend" 

### 1-on-1 Chat (Socket.IO)

Client connects with a token stored on the `User` model:

```javascript
import { io } from "socket.io-client";
const socket = io(API_BASE, { auth: { token: userToken } });

socket.on("connected", ({ userId }) => console.log("connected as", userId));
socket.on("message", (msg) => console.log("message", msg));
socket.on("inbox_update", (update) => console.log("inbox update:", update));
socket.on("read_receipt", (receipt) => console.log("read receipt:", receipt));
socket.on("message_edited", (msg) => console.log("message edited:", msg));
socket.on("message_deleted", (msg) => console.log("message deleted:", msg));

// Send message
socket.emit(
  "private_message",
  { recipientId, text: "Hello" },
  (ack) => console.log("ack", ack)
);

// Mark read
socket.emit("mark_read", { userId: otherUserId }, (ack) => console.log(ack));

// Edit message
socket.emit(
  "edit_message",
  { messageId: "msgId", text: "Updated text" },
  (ack) => console.log("edit ack:", ack)
);

// Delete message
socket.emit(
  "delete_message",
  { messageId: "msgId" },
  (ack) => console.log("delete ack:", ack)
);
```

REST endpoints:

- `GET /api/user/chat/history/:userId?limit=50&cursor=<ISO>`
- `POST /api/user/chat/read/:userId`"# subset-backend" 
