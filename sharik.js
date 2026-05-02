const express = require("express");

process.on('uncaughtException', (err) => {
    console.error('🚨 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 UNHANDLED REJECTION:', reason);
});

const app = express();
// Force port 3000 because Railway Target Port is set to 3000
const port = 3000;
const mongoose = require("mongoose");
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 30e6 // 30 MB
});
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "sharik_secret_key_2026_secure";

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "30mb" }));

const cors = require("cors");
app.use(cors());

const User = require("./modules/User");
const Message = require("./modules/Message");
const Article = require("./modules/myData");

// ═══════════════════════════════════════════════
// JWT Auth Middleware
// ═══════════════════════════════════════════════
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "جلسة غير صالحة، سجل الدخول مرة أخرى" });
  }
}



// ═══════════════════════════════════════════════
// 1) AUTH APIs - Register & Login
// ═══════════════════════════════════════════════
app.post("/api/register", async (req, res) => {
  try {
    const { username1, username2, email, password } = req.body;
    if (!username1 || !username2 || !email || !password) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ error: "هذا البريد مسجل بالفعل" });
    }
    const user = new User({
      username1: username1.trim(),
      username2: username2.trim(),
      email: email.toLowerCase().trim(),
      password: password,
    });
    await user.save();
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "حدث خطأ في التسجيل" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "البريد وكلمة المرور مطلوبان" });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "حدث خطأ في تسجيل الدخول" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "مستخدم غير موجود" });
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ error: "خطأ في جلب البيانات" });
  }
});

// Update avatar (base64)
app.put("/api/me/avatar", authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar) return res.status(400).json({ error: "الصورة مطلوبة" });
    // Limit to ~2MB base64
    if (avatar.length > 2.8 * 1024 * 1024) {
      return res.status(413).json({ error: "حجم الصورة كبير جداً (الحد الأقصى 2MB)" });
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { avatar },
      { new: true }
    );
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ error: "خطأ في تحديث الصورة" });
  }
});

// ═══════════════════════════════════════════════
// 2) SKILLS APIs - Save skills
// ═══════════════════════════════════════════════
app.post("/api/skills", authMiddleware, async (req, res) => {
  try {
    const { learnSkills, teachSkills } = req.body;
    if (!learnSkills || !teachSkills || learnSkills.length === 0 || teachSkills.length === 0) {
      return res.status(400).json({ error: "يجب اختيار مهارة واحدة على الأقل من كل قسم" });
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { learnSkills, teachSkills },
      { new: true }
    );
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ error: "خطأ في حفظ المهارات" });
  }
});

// ═══════════════════════════════════════════════
// 3) SKILL TEST APIs
// ═══════════════════════════════════════════════
app.post("/api/skill-test/submit", authMiddleware, async (req, res) => {
  try {
    const { skill, score, total, passed, pct } = req.body;
    if (!skill) return res.status(400).json({ error: "المهارة مطلوبة" });

    const update = {};
    update[`skillTestResults.${skill}`] = {
      pct: pct || Math.round((score / total) * 100),
      passed: passed,
      date: new Date().toISOString(),
    };

    if (passed) {
      await User.findByIdAndUpdate(req.userId, {
        $set: update,
        $addToSet: { verifiedSkills: skill },
      });
    } else {
      await User.findByIdAndUpdate(req.userId, { $set: update });
    }

    const user = await User.findById(req.userId);
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ user: safeUser, passed });
  } catch (err) {
    res.status(500).json({ error: "خطأ في حفظ نتيجة الاختبار" });
  }
});

// ═══════════════════════════════════════════════
// 4) MATCHING API
// ═══════════════════════════════════════════════
app.get("/api/matches", authMiddleware, async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId);
    if (!currentUser || !currentUser.learnSkills.length || !currentUser.teachSkills.length) {
      return res.json({ matches: [] });
    }

    const allUsers = await User.find({
      _id: { $ne: currentUser._id },
      learnSkills: { $exists: true, $ne: [] },
      teachSkills: { $exists: true, $ne: [] },
      verifiedSkills: { $exists: true, $ne: [] },
    });

    const matches = allUsers
      .filter((user) => {
        // يجب أن يمتلك المستخدم الآخر المهارة التي أريد تعلمها، وأن يكون قد اجتاز اختبارها
        const canTeachMe = user.teachSkills.some((s) => 
          currentUser.learnSkills.includes(s) && user.verifiedSkills.includes(s)
        );
        
        // يجب أن أمتلك أنا المهارة التي يريد المستخدم الآخر تعلمها، وأن أكون قد اجتزت اختبارها
        const canLearnFrom = user.learnSkills.some((s) => 
          currentUser.teachSkills.includes(s) && currentUser.verifiedSkills.includes(s)
        );
        
        // المطابقة تتم فقط إذا كان هناك تبادل منفعة (كل شخص يفيد الآخر)
        return canTeachMe && canLearnFrom;
      })
      .map((user) => {
        const learnM = user.teachSkills.filter((s) => currentUser.learnSkills.includes(s) && user.verifiedSkills.includes(s)).length;
        const teachM = user.learnSkills.filter((s) => currentUser.teachSkills.includes(s) && currentUser.verifiedSkills.includes(s)).length;
        const total = currentUser.learnSkills.length + currentUser.teachSkills.length || 1;
        const matchScore = Math.round(((learnM + teachM) / total) * 100);
        const safe = user.toSafeObject();
        safe.name = safe.username1 + " " + safe.username2;
        safe.matchScore = matchScore;
        return safe;
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    res.json({ matches });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "خطأ في البحث عن شركاء" });
  }
});

// ═══════════════════════════════════════════════
// 5) CHAT APIs
// ═══════════════════════════════════════════════
app.get("/api/messages/:chatId", authMiddleware, async (req, res) => {
  try {
    const messages = await Message.find({ chatId: req.params.chatId }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: "خطأ في جلب الرسائل" });
  }
});

app.post("/api/messages", authMiddleware, async (req, res) => {
  try {
    const { chatId, receiver, text, attachments } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "مستخدم غير موجود" });

    const message = new Message({
      chatId,
      sender: user.email,
      receiver,
      text: text || "",
      attachments: attachments || [],
    });
    await message.save();

    // Emit via socket
    io.to(chatId).emit("newMessage", message);

    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: "خطأ في إرسال الرسالة" });
  }
});

// Get user by email (for profile/chat)
app.get("/api/user/:email", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ error: "مستخدم غير موجود" });
    const safeUser = user.toSafeObject();
    safeUser.name = safeUser.username1 + " " + safeUser.username2;
    res.json({ user: safeUser });
  } catch (err) {
    res.status(500).json({ error: "خطأ في جلب بيانات المستخدم" });
  }
});

// ═══════════════════════════════════════════════
// SOCKET.IO - Real-time Chat
// ═══════════════════════════════════════════════
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("joinChat", (chatId) => {
    socket.join(chatId);
    console.log(`📌 Socket ${socket.id} joined chat: ${chatId}`);
  });

  socket.on("sendMessage", async (data) => {
    try {
      const message = new Message({
        chatId: data.chatId,
        sender: data.sender,
        receiver: data.receiver,
        text: data.text || "",
        attachments: data.attachments || [],
      });
      await message.save();
      io.to(data.chatId).emit("newMessage", message);
    } catch (err) {
      console.log("Socket message error:", err);
    }
  });

  socket.on("typing", (data) => {
    socket.to(data.chatId).emit("userTyping", { email: data.email });
  });

  socket.on("stopTyping", (data) => {
    socket.to(data.chatId).emit("userStopTyping", { email: data.email });
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

// ═══════════════════════════════════════════════
// MongoDB Connection & Server Start
// ═══════════════════════════════════════════════
// Start server first so Railway doesn't timeout
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Sharik server running on port ${port}`);
});

mongoose
  .connect(
    "mongodb+srv://sharik:O8hu92ELD8gflCSd@cluster0.vbdcynq.mongodb.net/all-data?appName=Cluster0"
  )
  .then(() => {
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
  });
