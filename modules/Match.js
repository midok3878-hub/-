const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    // Sorted emails to ensure uniqueness regardless of order
    userA: { type: String, required: true, lowercase: true, trim: true },
    userB: { type: String, required: true, lowercase: true, trim: true },
    // who sent the request
    initiator: { type: String, required: true, lowercase: true, trim: true },
    // pending | accepted | rejected
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    // chatId is created once both accept
    chatId: { type: String, default: "" },
  },
  { timestamps: true }
);

// Unique index: one match record per pair regardless of order
matchSchema.index({ userA: 1, userB: 1 }, { unique: true });

// Helper: canonical pair [sorted]
matchSchema.statics.makePair = function (emailA, emailB) {
  const a = emailA.toLowerCase().trim();
  const b = emailB.toLowerCase().trim();
  return a < b ? [a, b] : [b, a];
};

// Helper: find existing match between two users
matchSchema.statics.findBetween = function (emailA, emailB) {
  const [userA, userB] = this.makePair(emailA, emailB);
  return this.findOne({ userA, userB });
};

// Helper: build chatId from two emails
matchSchema.statics.buildChatId = function (emailA, emailB) {
  const [a, b] = this.makePair(emailA, emailB);
  return `${a}_${b}`;
};

const Match = mongoose.model("Match", matchSchema);
module.exports = Match;
