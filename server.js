const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5001;

// Configurar CORS para permitir el origen del frontend en vivo
app.use(cors({
    origin: 'https://detodo.onrender.com' // <-- MODIFICADO: URL de tu frontend en Render
}));

// Middleware para procesar JSON solo en rutas que no son el webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});
// Servir archivos estáticos de las imágenes
app.use('/uploads', express.static('uploads'));

const uri = process.env.MONGODB_URI;
// Agrega los parámetros TLS directamente a la URL de conexión
const mongoURI = `${uri}&tls=true&tlsInsecure=true`;

const client = new MongoClient(mongoURI);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

async function run() {
    try {
        await client.connect();
        const db = client.db('detodo');
        const usersCollection = db.collection('users');
        const productsCollection = db.collection('products');
        const messagesCollection = db.collection('messages');
        const brandsCollection = db.collection('brands');

        const backendUrl = process.env.BACKEND_URL;

        // Middleware de Autenticación simple
        const checkAuth = (req, res, next) => {
            const userId = req.headers['x-user-id']; 
            if (userId) {
                req.userId = userId;
                next();
            } else {
                res.status(401).json({ message: 'No autenticado' });
            }
        };

        // Middleware para verificar la suscripción del usuario
        const checkSubscription = async (req, res, next) => {
            if (!req.userId) return res.status(401).json({ message: 'No autenticado' });

            try {
                const user = await usersCollection.findOne({ _id: new ObjectId(req.userId) });
                if (user && user.hasActiveSubscription) {
                    req.user = user;
                    next();
                } else {
                    res.status(403).json({ message: 'Se requiere una suscripción activa para realizar esta acción.' });
                }
            } catch (error) {
                res.status(500).json({ message: 'Error al verificar suscripción' });
            }
        };

        // RUTAS DE AUTENTICACIÓN
        app.post('/api/auth/signup', async (req, res) => {
            const { email, password, username } = req.body;
            const existingUser = await usersCollection.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ message: 'El correo ya está registrado.' });
            }

            const newUser = {
                email,
                password, // ADVERTENCIA: Usar bcrypt para hashear en producción
                username: username || email.split('@')[0],
                hasActiveSubscription: false,
                createdAt: new Date(),
            };

            const result = await usersCollection.insertOne(newUser);
            const userResponse = {
                uid: result.insertedId.toString(),
                email: newUser.email,
                username: newUser.username,
                hasActiveSubscription: newUser.hasActiveSubscription,
            };

            res.status(201).json({ user: userResponse, message: 'Registro exitoso.', ok: true });
        });

        app.post('/api/auth/signin', async (req, res) => {
            const { email, password } = req.body;
            const user = await usersCollection.findOne({ email, password }); // ADVERTENCIA: Comparar hash en producción

            if (user) {
                const userResponse = {
                    uid: user._id.toString(),
                    email: user.email,
                    username: user.username,
                    hasActiveSubscription: user.hasActiveSubscription,
                };
                res.json({ user: userResponse, message: 'Inicio de sesión exitoso.', ok: true });
            } else {
                res.status(401).json({ message: 'Credenciales inválidas.', ok: false });
            }
        });

        // RUTAS DE PRODUCTOS
        app.post('/api/products/add', checkAuth, checkSubscription, upload.array('imageFiles', 5), async (req, res) => {
            const { name, description, price, condition } = req.body;
            const images = req.files.map(file => `${backendUrl}/uploads/${file.filename}`);
            const seller_id = req.userId;

            const newProduct = {
                name,
                description,
                price: parseFloat(price),
                condition,
                images,
                seller_id,
                is_sold: false,
                createdAt: new Date(),
            };

            const result = await productsCollection.insertOne(newProduct);
            res.status(201).json({ message: 'Producto agregado con éxito', productId: result.insertedId });
        });

        app.get('/api/products', async (req, res) => {
            const products = await productsCollection.find({ is_sold: false }).sort({ createdAt: -1 }).limit(20).toArray();
            res.json(products);
        });

        app.get('/api/products/by-user/:userId', async (req, res) => {
            try {
                const userId = req.params.userId;
                const products = await productsCollection.find({ seller_id: userId }).sort({ createdAt: -1 }).toArray();
                res.json(products);
            } catch (error) {
                res.status(400).json({ message: 'ID de usuario inválido' });
            }
        });

        app.get('/api/products/:id', async (req, res) => {
            try {
                const id = new ObjectId(req.params.id);
                const product = await productsCollection.findOne({ _id: id });

                if (!product) {
                    return res.status(404).json({ message: 'Producto no encontrado' });
                }
                res.json(product);
            } catch (error) {
                res.status(400).json({ message: 'ID de producto inválido' });
            }
        });

        // RUTAS DE MENSAJES/PREGUNTAS
        app.get('/api/messages/:productId', async (req, res) => {
            try {
                const productId = req.params.productId;
                const messages = await messagesCollection.find({ productId }).sort({ createdAt: 1 }).toArray();
                res.json(messages);
            } catch (error) {
                res.status(500).json({ message: 'Error al cargar mensajes' });
            }
        });

        app.post('/api/messages/add', checkAuth, async (req, res) => {
            const { productId, message, parentId } = req.body;
            const senderId = req.userId;

            const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
            const sender = await usersCollection.findOne({ _id: new ObjectId(senderId) });
            
            if (!product || !sender) {
                return res.status(404).json({ message: 'Producto o usuario no encontrado.' });
            }

            const newMessage = {
                productId,
                senderId,
                senderUsername: sender.username,
                message,
                parentId: parentId || null,
                createdAt: new Date(),
            };

            await messagesCollection.insertOne(newMessage);
            res.status(201).json({ message: 'Mensaje enviado' });
        });

        // RUTAS DE USUARIOS
        app.get('/api/users/:id', async (req, res) => {
            try {
                const id = new ObjectId(req.params.id);
                const user = await usersCollection.findOne({ _id: id });
    
                if (user) {
                    res.json({ uid: user._id.toString(), email: user.email, username: user.username, hasActiveSubscription: user.hasActiveSubscription });
                } else {
                    res.status(404).json({ message: 'Usuario no encontrado' });
                }
            } catch (error) {
                res.status(400).json({ message: 'ID de usuario inválido' });
            }
        });

        // RUTAS DE STRIPE Y WEBHOOK
        app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
            const signature = req.headers['stripe-signature'];
            let event;
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

            try {
                event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
            } catch (err) {
                console.error(`Error de Webhook: ${err.message}`);
                return res.status(400).send(`Webhook Error: ${err.message}`);
            }

            if (event.type === 'checkout.session.completed') {
                const session = event.data.object;
                const userId = session.client_reference_id;
                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { hasActiveSubscription: true } }
                );
            }
            res.status(200).end();
        });

        app.listen(port, () => {
            console.log(`Servidor corriendo en el puerto: ${port}`);
        });

    } catch (err) {
        console.error('Error de conexión a la base de datos:', err);
    }
}

run();