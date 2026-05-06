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
    sessionMeta: {
      teacher: { type: String, default: "" },
      learner: { type: String, default: "" },
      permissions: {
        type: Map,
        of: {
          canDraw: { type: Boolean, default: true },
          canUseText: { type: Boolean, default: true },
          canUpload: { type: Boolean, default: true },
          canControl: { type: Boolean, default: false },
        },
        default: {},
      },
      boardLocked: { type: Boolean, default: false },
      followMode: { type: Boolean, default: false },
      activeTemplate: { type: String, default: "blank" },
      recordingActive: { type: Boolean, default: false },
      recordingStartedAt: { type: Date, default: null },
      roleModeActive: { type: Boolean, default: false },
      lockExpiresAt: { type: Date, default: null },
    },
    assets: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            type: { type: String, enum: ["image", "pdf-page"], default: "image" },
            name: { type: String, default: "" },
            mime: { type: String, default: "" },
            key: { type: String, default: "" },
            page: { type: Number, default: 1 },
            width: { type: Number, default: 0 },
            height: { type: Number, default: 0 },
            createdBy: { type: String, default: "" },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    recordingLog: {
      type: [
        new Schema(
          {
            ts: { type: Number, required: true },
            event: { type: String, required: true },
            sender: { type: String, default: "" },
            payload: { type: Schema.Types.Mixed, default: {} },
          },
          { _id: false }
        ),
      ],
      default: [],
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
