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

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

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
  filename: (_, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
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

async function bootstrap() {
  await client.connect();
  const db = client.db("detodo");
  const Users = db.collection("users");
  const Products = db.collection("products");
  const Messages = db.collection("messages");
  const Trades = db.collection("trades");
  const Brands = db.collection("brands");

  // -------------------------
  // AUTH
  // -------------------------
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, username } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ message: "Email y password requeridos" });

      const exists = await Users.findOne({ email });
      if (exists)
        return res.status(400).json({ message: "El correo ya está registrado" });

      const hash = await bcrypt.hash(password, 10);
      const userDoc = {
        email,
        password: hash,
        username: (username || email.split("@")[0]).trim(),
        hasActiveSubscription: false,
        role: "user",
        createdAt: new Date(),
      };
      const { insertedId } = await Users.insertOne(userDoc);
      const user = { _id: insertedId, ...userDoc };
      const token = signToken(user);
      res.status(201).json({
        ok: true,
        message: "Registro exitoso",
        token,
        user: {
          uid: insertedId.toString(),
          email: user.email,
          username: user.username,
          hasActiveSubscription: user.hasActiveSubscription,
          role: user.role,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error en registro" });
    }
  });

  app.post("/api/auth/signin", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const user = await Users.findOne({ email });
      if (!user) return res.status(401).json({ message: "Credenciales inválidas" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ message: "Credenciales inválidas" });

      const token = signToken(user);
      res.json({
        ok: true,
        message: "Inicio de sesión exitoso",
        token,
        user: {
          uid: user._id.toString(),
          email: user.email,
          username: user.username,
          hasActiveSubscription: user.hasActiveSubscription,
          role: user.role || "user",
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Error en inicio de sesión" });
    }
  });

  app.get("/api/users/:uid", async (req, res) => {
    try {
      const _id = new ObjectId(req.params.uid);
      const user = await Users.findOne({ _id }, { projection: { password: 0 } });
      if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
      res.json(user);
    } catch {
      res.status(400).json({ message: "ID inválido" });
    }
  });

  // -------------------------
  // STRIPE WEBHOOK
  // -------------------------
  app.post(
    "/api/webhook",
    bodyParser.raw({ type: "application/json" }),
    (req, res) => {
      const sig = req.headers["stripe-signature"];
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        console.error("⚠️ Error en webhook:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case "checkout.session.completed":
          console.log("✅ Pago completado");
          break;
        case "invoice.payment_failed":
          console.log("❌ Pago fallido");
          break;
        default:
          console.log(`Evento no manejado: ${event.type}`);
      }

      res.json({ received: true });
    }
  );

  // -------------------------
  // PRODUCTS
  // -------------------------
  app.post(
    "/api/products/add",
    authRequired,
    upload.array("images", 5),
    async (req, res) => {
      try {
        const { name, description, price, condition, currency, is_trade } =
          req.body || {};
        if (!name || !description || !price)
          return res.status(400).json({ message: "Datos incompletos" });

        const images = (req.files || []).map(
          (f) => `${BACKEND_URL}/uploads/${f.filename}`
        );
        const doc = {
          name,
          description,
          price: parseFloat(price),
          condition,
          currency: currency || "MXN",
          images,
          seller_id: req.auth.uid,
          status: "disponible",
          is_trade: Boolean(is_trade),
          createdAt: new Date(),
        };

        const { insertedId } = await Products.insertOne(doc);
        res
          .status(201)
          .json({ message: "Producto agregado", productId: insertedId });
      } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Error al agregar producto" });
      }
    }
  );

  app.get("/api/products", async (req, res) => {
    try {
      const { name, brand, minPrice, maxPrice } = req.query;
      const q = { status: { $ne: "vendido" } };

      if (name) q.name = { $regex: new RegExp(name, "i") };
      if (brand) q.brand = brand;
      if (minPrice || maxPrice) {
        q.price = {};
        if (minPrice) q.price.$gte = parseFloat(minPrice);
        if (maxPrice) q.price.$lte = parseFloat(maxPrice);
      }

      const items = await Products.find(q).sort({ createdAt: -1 }).toArray();
      res.json(items);
    } catch (e) {
      res.status(500).json({ message: "Error al listar productos" });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const _id = new ObjectId(req.params.id);
      const product = await Products.findOne({ _id });
      if (!product) return res.status(404).json({ message: "No encontrado" });
      res.json(product);
    } catch {
      res.status(400).json({ message: "ID inválido" });
    }
  });

  app.put("/api/products/sold/:id", authRequired, async (req, res) => {
    try {
      const _id = new ObjectId(req.params.id);
      const p = await Products.findOne({ _id });
      if (!p) return res.status(404).json({ message: "No encontrado" });
      if (p.seller_id !== req.auth.uid)
        return res.status(403).json({ message: "No autorizado" });

      await Products.updateOne({ _id }, { $set: { status: "vendido" } });
      res.json({ message: "Marcado como vendido" });
    } catch {
      res.status(400).json({ message: "ID inválido" });
    }
  });

  app.delete("/api/products/:id", authRequired, async (req, res) => {
    try {
      const _id = new ObjectId(req.params.id);
      const p = await Products.findOne({ _id });
      if (!p) return res.status(404).json({ message: "No encontrado" });
      if (p.seller_id !== req.auth.uid)
        return res.status(403).json({ message: "No autorizado" });

      await Products.deleteOne({ _id });
      res.json({ message: "Eliminado" });
    } catch {
      res.status(400).json({ message: "ID inválido" });
    }
  });

  // -------------------------
  // MENSAJES
  // -------------------------
  app.get("/api/messages/by-product/:productId", async (req, res) => {
    try {
      const productId = req.params.productId;
      const msgs = await Messages.find({ productId })
        .sort({ createdAt: 1 })
        .toArray();
      res.json(msgs);
    } catch {
      res.status(500).json({ message: "Error al cargar mensajes" });
    }
  });

  app.post("/api/messages", authRequired, async (req, res) => {
    try {
      const { productId, message } = req.body || {};
      if (!productId || !message)
        return res.status(400).json({ message: "Datos incompletos" });
      const doc = {
        productId,
        senderId: req.auth.uid,
        senderUsername: req.auth.email.split("@")[0],
        message,
        createdAt: new Date(),
      };
      const { insertedId } = await Messages.insertOne(doc);
      res.status(201).json({ message: "OK", id: insertedId });
    } catch {
      res.status(500).json({ message: "Error al enviar mensaje" });
    }
  });

  // -------------------------
  // TRUEQUES
  // -------------------------
  app.post("/api/trades", authRequired, async (req, res) => {
    try {
      const { product_offered, product_requested } = req.body || {};
      if (!product_offered || !product_requested)
        return res.status(400).json({ message: "Datos incompletos" });

      const offered = await Products.findOne({
        _id: new ObjectId(product_offered),
      });
      const requested = await Products.findOne({
        _id: new ObjectId(product_requested),
      });
      if (!offered || !requested)
        return res.status(404).json({ message: "Producto no encontrado" });
      if (offered.seller_id !== req.auth.uid)
        return res
          .status(403)
          .json({ message: "No puedes ofrecer un producto que no es tuyo" });

      const doc = {
        product_offered,
        product_requested,
        proposer_id: req.auth.uid,
        owner_id: requested.seller_id,
        status: "pendiente",
        createdAt: new Date(),
      };
      const { insertedId } = await Trades.insertOne(doc);
      res.status(201).json({ message: "Propuesta enviada", tradeId: insertedId });
    } catch {
      res.status(500).json({ message: "Error al crear trueque" });
    }
  });

  app.put("/api/trades/:id", authRequired, async (req, res) => {
    try {
      const _id = new ObjectId(req.params.id);
      const { action } = req.body || {};
      const t = await Trades.findOne({ _id });
      if (!t) return res.status(404).json({ message: "Trueque no encontrado" });
      if (t.owner_id !== req.auth.uid)
        return res.status(403).json({ message: "No autorizado" });

      if (!["aceptar", "rechazar"].includes(action))
        return res.status(400).json({ message: "Acción inválida" });

      const status = action === "aceptar" ? "aprobado" : "rechazado";
      await Trades.updateOne({ _id }, { $set: { status } });

      if (status === "aprobado") {
        await Products.updateOne(
          { _id: new ObjectId(t.product_offered) },
          { $set: { status: "vendido" } }
        );
        await Products.updateOne(
          { _id: new ObjectId(t.product_requested) },
          { $set: { status: "vendido" } }
        );
      }

      res.json({ message: `Trueque ${status}` });
    } catch {
      res.status(400).json({ message: "ID inválido" });
    }
  });

  app.get("/api/trades/mine", authRequired, async (req, res) => {
    const uid = req.auth.uid;
    const list = await Trades.find({
      $or: [{ proposer_id: uid }, { owner_id: uid }],
    })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(list);
  });

  // -------------------------
  // BRANDS
  // -------------------------
  app.get("/api/brands", async (_req, res) => {
    const items = await Brands.find().sort({ name: 1 }).toArray();
    res.json(items.map((b) => b.name || b));
  });

  app.listen(port, () =>
    console.log(`🚀 Backend listo en http://localhost:${port}`)
  );
}

bootstrap().catch((e) => {
  console.error("Error al iniciar servidor:", e);
  process.exit(1);
});
