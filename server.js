const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
require("dotenv").config();

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

// Middlewares
app.use(express.json());
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

// JWT
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

// Middleware de autenticación
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
// Bootstrap con rutas
// -------------------------
async function bootstrap() {
  await client.connect();
  const db = client.db("detodo");

  const Users = db.collection("users");
  const Products = db.collection("products");
  const Messages = db.collection("messages");
  const Trades = db.collection("trades");
  const Brands = db.collection("brands");

  // -------------------------
  // API: Productos
  // -------------------------
  app.get("/api/products", async (req, res) => {
    try {
      const items = await Products.find({}).toArray();
      res.json(items);
    } catch (err) {
      console.error("Error obteniendo productos:", err);
      res.status(500).json({ error: "Error interno al cargar productos" });
    }
  });

  // Semilla opcional (ejecutar 1 vez y luego borrar)
  app.post("/api/products/seed", async (req, res) => {
    try {
      const sample = [
        { name: "Camiseta", price: 200, description: "Camiseta de algodón" },
        { name: "Pantalón", price: 500, description: "Pantalón de mezclilla" },
        { name: "Zapatos", price: 800, description: "Zapatos de piel" },
      ];
      await Products.insertMany(sample);
      res.json({ message: "Productos iniciales insertados" });
    } catch (err) {
      res.status(500).json({ error: "Error al insertar productos" });
    }
  });

  // -------------------------
  // Otras rutas existentes (auth, users, etc.)
  // -------------------------
  // Aquí dejas tus otras rutas como ya las tienes configuradas

  // -------------------------
  // Iniciar servidor
  // -------------------------
  app.listen(port, () => {
    console.log(`🚀 Backend listo en http://localhost:${port}`);
  });
}

bootstrap().catch((e) => {
  console.error("Error al iniciar servidor:", e);
  process.exit(1);
});
