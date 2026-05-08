const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const messageSchema = new Schema(
  {
    chatId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    traceId: { type: String, default: "", index: true },
    text: { type: String, default: "" },
    attachments: [
      {
        name: String,
        type: { type: String, enum: ["image", "video", "audio", "voice", "file"] },
        mime: String,
        data: String,
        sizeStr: String,
      },
    ],
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
