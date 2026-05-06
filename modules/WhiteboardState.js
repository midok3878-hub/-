const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const whiteboardActionSchema = new Schema({}, { _id: false, strict: false });

const whiteboardStateSchema = new Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    lastActivity: { type: Date, default: Date.now, index: true },
    snapshot: {
      mime: { type: String, default: "" },
      key: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
    },
    actions: { type: [whiteboardActionSchema], default: [] },
    redoStack: { type: [whiteboardActionSchema], default: [] },
  },
  { timestamps: true }
);

const ttlSeconds = Math.max(
  86400,
  Number(process.env.WHITEBOARD_TTL_SECONDS || 60 * 60 * 24 * 30)
);
whiteboardStateSchema.index({ lastActivity: 1 }, { expireAfterSeconds: ttlSeconds });

const WhiteboardState = mongoose.model("WhiteboardState", whiteboardStateSchema);
module.exports = WhiteboardState;
