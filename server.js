const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5001;

// Configurar CORS para permitir solo el origen del frontend
app.use(cors({
    origin: 'https://detodounpoco-1.onrender.com'
}));

// Middleware para procesar JSON solo en rutas que no son el webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});
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

const checkSubscription = async (req, res, next) => {
    const userId = req.body.seller_id;

    if (!userId) {
        return res.status(401).json({ message: 'No autenticado.' });
    }

    try {
        const usersCollection = client.db('marketplaceDB').collection('users');
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

        if (user && user.hasActiveSubscription) {
            next();
        } else {
            res.status(403).json({ message: 'Se requiere una suscripción activa para publicar productos.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en la verificación de suscripción.' });
    }
};

async function run() {
    try {
        await client.connect();
        console.log("Conectado a MongoDB Atlas!");
        const database = client.db('marketplaceDB');
        const productsCollection = database.collection('products');
        const usersCollection = database.collection('users');
        const messagesCollection = database.collection('messages');

        // Ruta de inicio para verificar que el servidor está activo
        app.get('/', (req, res) => {
            res.send('El servidor backend de DeTodoUnPoco está en funcionamiento.');
        });
        
        const backendUrl = process.env.BACKEND_URL;

        // Rutas de la API
        app.get('/api/products', async (req, res) => {
            const { name, category_id, brand, minPrice, maxPrice } = req.query;
            let filter = { status: { $ne: 'vendido' } };

            if (name) {
                filter.name = { $regex: new RegExp(name, 'i') };
            }
            if (category_id) {
                filter.category_id = category_id;
            }
            if (brand) {
                filter.brand = brand;
            }
            if (minPrice) {
                filter.price = { ...filter.price, $gte: parseFloat(minPrice) };
            }
            if (maxPrice) {
                filter.price = { ...filter.price, $lte: parseFloat(maxPrice) };
            }

            try {
                const products = await productsCollection.find(filter).toArray();
                const productsWithFullUrl = products.map(product => ({
                    ...product,
                    images: product.images ? product.images.map(img => `${backendUrl}${img}`) : []
                }));
                res.json(productsWithFullUrl);
            } catch (error) {
                res.status(500).json({ message: 'Error al buscar productos', error: error.message });
            }
        });

        app.get('/api/brands', async (req, res) => {
            try {
                const brands = await productsCollection.distinct('brand');
                res.json(brands);
            } catch (error) {
                res.status(500).json({ message: 'Error al obtener las marcas', error: error.message });
            }
        });

        app.post('/api/products/add', checkSubscription, upload.array('images'), async (req, res) => {
            const newProduct = req.body;
            const imagePaths = [];
            
            if (req.files) {
                req.files.forEach(file => {
                    imagePaths.push(`/uploads/${file.filename}`);
                });
            }
            newProduct.images = imagePaths;
            newProduct.status = 'disponible';
            
            try {
                const result = await productsCollection.insertOne(newProduct);
                res.status(201).json({ message: 'Producto agregado con éxito', productId: result.insertedId });
            } catch (error) {
                res.status(500).json({ message: 'Error al agregar el producto', error: error.message });
            }
        });

        app.put('/api/products/:id', upload.array('images'), async (req, res) => {
            const { id } = req.params;
            const updatedProduct = req.body;
            const imagePaths = [];

            if (req.files) {
                req.files.forEach(file => {
                    imagePaths.push(`/uploads/${file.filename}`);
                });
                updatedProduct.images = imagePaths;
            }

            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedProduct }
                );
                if (result.matchedCount === 1) {
                    res.status(200).json({ message: 'Producto actualizado con éxito' });
                } else {
                    res.status(404).json({ message: 'Producto no encontrado' });
                }
            } catch (error) {
                res.status(500).json({ message: 'Error al actualizar el producto', error: error.message });
            }
        });

        app.delete('/api/products/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 1) {
                    res.status(200).json({ message: 'Producto eliminado con éxito' });
                } else {
                    res.status(404).json({ message: 'Producto no encontrado' });
                }
            } catch (error) {
                res.status(500).json({ message: 'Error al eliminar el producto', error: error.message });
            }
        });

        app.get('/api/products/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });
                if (product) {
                    product.images = product.images ? product.images.map(img => `${backendUrl}${img}`) : [];
                    res.json(product);
                } else {
                    res.status(404).json({ message: 'Producto no encontrado' });
                }
            } catch (error) {
                res.status(400).json({ message: 'ID de producto inválido' });
            }
        });

        app.put('/api/products/sold/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'vendido', soldDate: new Date() } }
                );
                if (result.matchedCount === 1) {
                    res.status(200).json({ message: 'Producto marcado como vendido' });
                } else {
                    res.status(404).json({ message: 'Producto no encontrado' });
                }
            } catch (error) {
                res.status(500).json({ message: 'Error al actualizar el producto', error: error.message });
            }
        });

        app.get('/api/products/by-user/:uid', async (req, res) => {
            const { uid } = req.params;
            try {
                const products = await productsCollection.find({ seller_id: uid }).toArray();
                const productsWithFullUrl = products.map(product => ({
                    ...product,
                    images: product.images ? product.images.map(img => `${backendUrl}${img}`) : []
                }));
                res.json(productsWithFullUrl);
            } catch (error) {
                res.status(500).json({ message: 'Error al obtener los productos del usuario', error: error.message });
            }
        });

        app.post('/api/messages', async (req, res) => {
            const { productId, senderId, receiverId, message, parentId = null } = req.body;
            try {
                const newMessage = {
                    productId: new ObjectId(productId),
                    senderId,
                    receiverId,
                    message,
                    parentId: parentId ? new ObjectId(parentId) : null,
                    timestamp: new Date()
                };
                await messagesCollection.insertOne(newMessage);
                res.status(201).json({ message: 'Mensaje enviado' });
            } catch (error) {
                res.status(500).json({ message: 'Error al enviar el mensaje', error: error.message });
            }
        });

        app.get('/api/messages/by-product/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const messages = await messagesCollection.find({ productId: new ObjectId(id) }).toArray();
                
                const userIds = [...new Set(messages.map(m => m.senderId).concat(messages.map(m => m.receiverId)))];
                const users = await usersCollection.find({ uid: { $in: userIds } }).toArray();
                
                const messagesWithUsernames = messages.map(msg => {
                    const sender = users.find(u => u.uid === msg.senderId);
                    const receiver = users.find(u => u.uid === msg.receiverId);
                    return {
                        ...msg,
                        senderUsername: sender ? sender.username : 'Usuario Desconocido',
                        receiverUsername: receiver ? receiver.username : 'Usuario Desconocido'
                    };
                });
                
                res.json(messagesWithUsernames);
            } catch (error) {
                res.status(500).json({ message: 'Error al obtener los mensajes', error: error.message });
            }
        });
        
        app.post('/api/auth/signin', async (req, res) => {
            const { email, password } = req.body;
            const user = await usersCollection.findOne({ email });
            if (user && user.password === password) {
                res.json({ ok: true, message: 'Inicio de sesión exitoso', user: { uid: user._id.toString(), username: user.username } });
            } else {
                res.status(401).json({ ok: false, message: 'Credenciales inválidas' });
            }
        });

        app.post('/api/auth/signup', async (req, res) => {
            const { email, password, username } = req.body;
            try {
                const existingUser = await usersCollection.findOne({ email });
                if (existingUser) {
                    return res.status(409).json({ ok: false, message: 'El email ya está registrado' });
                }
                const newUser = { email, password, username, hasActiveSubscription: false };
                const result = await usersCollection.insertOne(newUser);
                res.status(201).json({ ok: true, message: 'Registro exitoso', user: { uid: result.insertedId.toString(), username: newUser.username } });
            } catch (error) {
                res.status(500).json({ ok: false, message: 'Error al registrar el usuario', error: error.message });
            }
        });
        
        app.get('/api/users/:uid', async (req, res) => {
          const { uid } = req.params;
          try {
            const user = await usersCollection.findOne({ _id: new ObjectId(uid) });
            if (user) {
                res.json({ username: user.username, email: user.email, uid: user._id.toString(), hasActiveSubscription: user.hasActiveSubscription });
            } else {
                res.status(404).json({ message: 'Usuario no encontrado' });
            }
          } catch (error) {
            res.status(400).json({ message: 'ID de usuario inválido' });
          }
        });
        
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

    } finally {
        // ...
    }
}
run().catch(console.dir);