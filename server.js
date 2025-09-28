const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const bodyParser = require("body-parser");
require("dotenv").config();
const checkEnv = require("./checkEnv"); // Verificador de env
checkEnv(); // Valida antes de arrancar

const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

const app = express();
const port = process.env.PORT || 5001;

// -------------------------
// CORS dinámico
// -------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",");
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("No permitido por CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Webhook requiere raw
app.use((req, res, next) => {
  if (req.originalUrl === "/api/webhook") next();
  else express.json()(req, res, next);
});

// Archivos estáticos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// DB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// Multer
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, "./uploads"),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Helpers
const BACKEND_URL =
  process.env.BACKEND_URL || `http://localhost:${port}`;
const JWT_SECRET = process.env.JWT_SECRET;

const signToken = (user) =>
  jwt.sign(
    {
      uid: user._id.toString(),
      email: user.email,
      role: user.role || "user",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

const authRequired = (req, res, next) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token requerido" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ message: "Token inválido o expirado" });
  }
};

// -------------------------
// Resto de tu código igual
// -------------------------

async function bootstrap() {
  await client.connect();
  const db = client.db("detodo");
  const Users = db.collection("users");
  const Products = db.collection("products");
  const Messages = db.collection("messages");
  const Trades = db.collection("trades");
  const Brands = db.collection("brands");

  // (todas tus rutas se mantienen igual)
  // ...
  app.listen(port, () =>
    console.log(`🚀 Backend listo en http://localhost:${port}`)
  );
}

bootstrap().catch((e) => {
  console.error("Error al iniciar servidor:", e);
  process.exit(1);
});
