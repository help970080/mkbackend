import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(express.json());

// Configuración de CORS
const allowedOrigins = [
  "http://localhost:5173", // local dev
  "https://mercadito-7hlx.onrender.com" // frontend en Render
];
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true,
  })
);

// Conexión a MongoDB
const client = new MongoClient(process.env.MONGODB_URI);
let Products;

async function bootstrap() {
  try {
    await client.connect();
    const db = client.db("mercadito");
    Products = db.collection("products");
    console.log("✅ Conectado a MongoDB");

    // ---------------------------
    // Rutas API
    // ---------------------------

    // GET todos los productos
    app.get("/api/products", async (req, res) => {
      try {
        const items = await Products.find({}).toArray();
        res.json(items);
      } catch (err) {
        console.error("❌ Error obteniendo productos:", err);
        res.status(500).json({ error: "Error interno al cargar productos" });
      }
    });

    // POST producto nuevo
    app.post("/api/products", async (req, res) => {
      try {
        const product = req.body;
        const result = await Products.insertOne(product);
        res.status(201).json({ _id: result.insertedId, ...product });
      } catch (err) {
        console.error("❌ Error creando producto:", err);
        res.status(500).json({ error: "Error interno al crear producto" });
      }
    });

    // PUT actualizar producto
    app.put("/api/products/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const update = req.body;
        const result = await Products.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: update },
          { returnDocument: "after" }
        );
        if (!result.value) {
          return res.status(404).json({ error: "Producto no encontrado" });
        }
        res.json(result.value);
      } catch (err) {
        console.error("❌ Error actualizando producto:", err);
        res.status(500).json({ error: "Error interno al actualizar producto" });
      }
    });

    // DELETE eliminar producto
    app.delete("/api/products/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await Products.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
          return res.status(404).json({ error: "Producto no encontrado" });
        }
        res.json({ message: "Producto eliminado" });
      } catch (err) {
        console.error("❌ Error eliminando producto:", err);
        res.status(500).json({ error: "Error interno al eliminar producto" });
      }
    });

    // POST semilla de productos
    app.post("/api/products/seed", async (req, res) => {
      try {
        const sample = [
          {
            name: "Camiseta básica",
            price: 199,
            description: "Camiseta de algodón 100% en varios colores.",
            image: "https://picsum.photos/seed/camiseta/400/400",
          },
          {
            name: "Pantalón de mezclilla",
            price: 499,
            description: "Pantalón resistente de mezclilla azul clásico.",
            image: "https://picsum.photos/seed/pantalon/400/400",
          },
          {
            name: "Zapatos deportivos",
            price: 899,
            description: "Zapatos cómodos para correr y entrenar.",
            image: "https://picsum.photos/seed/zapatos/400/400",
          },
          {
            name: "Mochila escolar",
            price: 350,
            description: "Mochila ligera y resistente, ideal para estudiantes.",
            image: "https://picsum.photos/seed/mochila/400/400",
          },
          {
            name: "Audífonos inalámbricos",
            price: 750,
            description: "Audífonos Bluetooth con gran calidad de sonido.",
            image: "https://picsum.photos/seed/audifonos/400/400",
          },
          {
            name: "Reloj digital",
            price: 420,
            description: "Reloj digital resistente al agua.",
            image: "https://picsum.photos/seed/reloj/400/400",
          },
          {
            name: "Laptop 14''",
            price: 9500,
            description: "Laptop ligera para trabajo y estudio.",
            image: "https://picsum.photos/seed/laptop/400/400",
          },
          {
            name: "Smartphone",
            price: 7200,
            description: "Teléfono inteligente con pantalla AMOLED.",
            image: "https://picsum.photos/seed/smartphone/400/400",
          },
          {
            name: "Cafetera eléctrica",
            price: 1200,
            description: "Cafetera programable con jarra de vidrio.",
            image: "https://picsum.photos/seed/cafetera/400/400",
          },
          {
            name: "Silla ergonómica",
            price: 3100,
            description: "Silla cómoda para oficina con soporte lumbar.",
            image: "https://picsum.photos/seed/silla/400/400",
          },
        ];

        await Products.deleteMany({});
        const inserted = await Products.insertMany(sample);

        res.json({
          message: "Productos de ejemplo insertados",
          count: inserted.insertedCount,
        });
      } catch (err) {
        console.error("❌ Error en semilla:", err);
        res.status(500).json({ error: "Error al insertar productos" });
      }
    });

    // Iniciar servidor
    app.listen(PORT, () => {
      console.log(`🚀 Backend listo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error iniciando backend:", err);
    process.exit(1);
  }
}

bootstrap();
