import express from 'express';
import { resolve } from 'path';
import { engine } from 'express-handlebars';
import { neon } from '@neondatabase/serverless';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const sql = neon('postgresql://neondb_owner:WOPMmIFq9U4Z@ep-late-paper-a57gi6uz.us-east-2.aws.neon.tech/neondb?sslmode=require');

const app = express(); 
const port = 3000;

app.use(express.static('static'));

// Middleware para analizar el cuerpo de las solicitudes POST
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para analizar las cookies
app.use(cookieParser());

app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');

const JWT_SECRET = 'jwt_secret_key';

// Middleware para verificar token JWT
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.redirect('/login?error=Acceso denegado. Por favor, inicia sesión.');
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.redirect('/login?error=Inicia sesión de nuevo.');
        }
        req.user = user;
        next();
    });
};

// Middleware para verificar si el usuario es administrador
const checkAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.render('login', { error: 'Acceso denegado. Solo los administradores pueden acceder a esta página.' });
    }
    next();
};

// Middleware para redirigir si el usuario ya está autenticado
const redirectIfAuthenticated = (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                return next();
            }
            return res.redirect('/?message=Ya has iniciado sesión');
        });
    } else {
        next();
    }
};

app.get('/', async (req, res) => {
    const message = req.query.message;
    
    try {
        const result = await sql`
            SELECT id, img, title, price FROM products
        `;
        const products = result;
        res.render('index', { message, products });
    } catch (error) {
        console.error('Error al obtener los productos:', error);
        res.send('Error al obtener los productos');
    }
});

app.get('/admin', authenticateToken, checkAdmin, async (req, res) => {
    try {
        // Obtener todos los productos
        const products = await sql`
            SELECT id, title, price, stock, img FROM products
        `;

        // Obtener el monto total de ventas
        const totalSalesResult = await sql`
            SELECT SUM(amount) AS total_sales FROM receipts
        `;
        const totalSales = totalSalesResult[0]?.total_sales || 0;

        // Obtener los productos más vendidos
        const topProducts = await sql`
            SELECT 
                p.title AS product_title, 
                SUM(s.quantity) AS total_sold 
            FROM sales s
            JOIN products p ON s.product_id = p.id
            GROUP BY p.title
            ORDER BY total_sold DESC
            LIMIT 10;
        `;

        // Obtener los productos con stock bajo
        const lowStockProducts = await sql`
            SELECT title, stock 
            FROM products 
            WHERE stock < 10
            ORDER BY stock ASC;
        `;

        // devolución mayor a 3 veces
        const returnedProducts = await sql`
            SELECT 
                p.title AS product_title, 
                COUNT(r.id) AS returns_count 
            FROM returns r
            JOIN products p ON r.product_id = p.id
            GROUP BY p.title
            HAVING COUNT(r.id) >= 3
            ORDER BY returns_count DESC;
        `;

        // Historial de compras
        const purchaseHistory = await sql`
            SELECT 
                u.name AS customer_name, 
                p.title AS product_title, 
                s.quantity, 
                s.order_date 
            FROM sales s
            JOIN users u ON s.user_id = u.id
            JOIN products p ON s.product_id = p.id
            ORDER BY s.order_date DESC;
        `;
 // Número total de productos por categoría, ordenado de mayor a menor
 const productsByCategory = await sql`
 SELECT 
     p.category, 
     COUNT(p.id) AS total_products 
 FROM products p
 GROUP BY p.category
 ORDER BY total_products DESC;
`;


        // Renderizar el panel de administración con los datos obtenidos
        res.render('admin', {
            products,
            totalSales: parseFloat(totalSales).toFixed(2),
            topProducts: topProducts.length > 0 ? topProducts : null,
            lowStockProducts: lowStockProducts.length > 0 ? lowStockProducts : null,
            returnedProducts: returnedProducts.length > 0 ? returnedProducts : null,
            purchaseHistory: purchaseHistory.length > 0 ? purchaseHistory : null,
            productsByCategory: productsByCategory.length > 0 ? productsByCategory : null,
        });
    } catch (error) {
        console.error('Error al cargar el panel de administración:', error);
        res.render('admin', { error: 'Error al cargar el panel de administración.' });
    }
});

// Productos por región
app.get('/products-region', async (req, res) => {
    try {
        const products = await sql`
            SELECT p.title, p.price, p.stock, s.region
            FROM products p
            JOIN stores s ON p.store_id = s.id
        `;
        res.render('products-region', { products });
    } catch (error) {
        console.error('Error al obtener productos por región:', error);
        res.render('products-region', { error: 'Error al cargar productos por región.' });
    }
});

// Productos con descuento
app.get('/discounted-products', async (req, res) => {
    try {
        const discountedProducts = await sql`
            SELECT title, price, discount
            FROM products
            WHERE discount > 0
        `;
        res.render('discounted-products', { discountedProducts });
    } catch (error) {
        console.error('Error al cargar productos con descuento:', error);
        res.render('discounted-products', { error: 'Error al cargar productos con descuento.' });
    }
});

// Stock inicial por mes
app.get('/initial-stock/:month', async (req, res) => {
    try {
        const month = req.params.month;

        const initialStock = await sql`
            SELECT 
                p.title AS product_name, 
                i.initial_stock 
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE EXTRACT(MONTH FROM i.initial_stock_date) = ${month}
        `;

        if (initialStock.length === 0) {
            return res.render('initial-stock', {
                error: `No se encontró información para el mes: ${month}`
            });
        }

        res.render('initial-stock', { initialStock, month });
    } catch (error) {
        console.error('Error al consultar el stock inicial:', error);
        res.render('initial-stock', { error: 'Error al consultar el stock inicial.' });
    }
});




// Rutas para autenticación (registro e inicio de sesión)
app.get('/signup', redirectIfAuthenticated, (req, res) => {
    res.render('signup');
});

// Ruta para procesar el registro de usuarios
app.post('/signup', async (req, res) => {
    const { country, name, email, password, role } = req.body;

    if (!country || !name || !email || !password) {
        return res.render('signup', { error: 'Todos los campos son obligatorios.' });
    }

    try {
        const existingUser = await sql`
            SELECT * FROM users WHERE email = ${email}
        `;

        if (existingUser.length > 0) {
            return res.render('signup', { error: 'El email ya está registrado.' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        await sql`
            INSERT INTO users (country, name, email, password, role, wallet) 
            VALUES (${country}, ${name}, ${email}, ${hashedPassword}, ${role || 'user'}, 100.00)
        `;

        res.redirect('/login');
    } catch (error) {
        console.error('Error al registrar el usuario:', error);
        res.render('signup', { error: 'Ocurrió un error en el servidor. Por favor, inténtalo de nuevo más tarde.' });
    }
});

// Ruta para el formulario de inicio de sesión
app.get('/login', redirectIfAuthenticated, (req, res) => {
    const error = req.query.error;
    res.render('login', { error });
});

// Ruta para procesar el inicio de sesión
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.render('login', { error: 'Todos los campos son obligatorios.' });
    }

    try {
        const user = await sql`
            SELECT * FROM users WHERE email = ${email}
        `;

        if (user.length === 0) {
            return res.render('login', { error: 'El usuario no existe.' });
        }

        const passwordMatch = bcrypt.compareSync(password, user[0].password);
        if (!passwordMatch) {
            return res.render('login', { error: 'Contraseña incorrecta.' });
        }

 
        const token = jwt.sign(
            { id: user[0].id, role: user[0].role },
            JWT_SECRET,
            { expiresIn: '1h' } 
        );

        res.cookie('token', token, { httpOnly: true });


        res.redirect('/');
    } catch (error) {
        console.error('Error al iniciar sesión:', error);
        res.render('login', { error: 'Ocurrió un error en el servidor. Por favor, inténtalo más tarde.' });
    }
});

// Ruta para cerrar sesión
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login?message=Cerraste sesión correctamente.');
});

// Ruta para el perfil del usuario
app.get('/profile', authenticateToken, async (req, res) => {
    try {
        const result = await sql`
            SELECT name, email, wallet 
            FROM users 
            WHERE id = ${req.user.id}
        `;
        const user = result[0];

        if (user) {
            res.render('profile', { 
                name: user.name, 
                email: user.email, 
                wallet: user.wallet 
            });
        } else {
            res.render('profile', { error: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error('Error al obtener el perfil:', error);
        res.render('profile', { error: 'Error al obtener el perfil del usuario.' });
    }
});


app.get('/cart', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        // Obtener los productos en el carrito del usuario
        const cartItems = await sql`
            SELECT 
                p.id AS product_id, 
                p.title, 
                p.price, 
                c.quantity, 
                (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.id
            WHERE c.user_id = ${userId}
        `;

        // Obtener la wallet del usuario
        const user = await sql`
            SELECT wallet FROM users WHERE id = ${userId}
        `;

        const wallet = user[0]?.wallet || 0;

        // Calcular el total del carrito
        const total = cartItems.reduce((sum, item) => sum + parseFloat(item.total), 0).toFixed(2);

        res.render('cart', { cart: cartItems, wallet, total });
    } catch (error) {
        console.error('Error al cargar el carrito:', error);
        res.render('cart', { error: 'Error al cargar el carrito.' });
    }
});

app.post('/add-to-cart', authenticateToken, async (req, res) => {
    const { productId } = req.body;
    const userId = req.user.id;

    try {
        // Verificar si el producto ya está en el carrito del usuario
        const cartItem = await sql`
            SELECT * FROM cart WHERE user_id = ${userId} AND product_id = ${productId}
        `;

        if (cartItem.length > 0) {
            // Incrementar la cantidad si ya existe
            await sql`
                UPDATE cart 
                SET quantity = quantity + 1 
                WHERE user_id = ${userId} AND product_id = ${productId}
            `;
        } else {
            // Agregar un nuevo producto al carrito
            await sql`
                INSERT INTO cart (user_id, product_id, quantity) 
                VALUES (${userId}, ${productId}, 1)
            `;
        }

        res.redirect('/cart');
    } catch (error) {
        console.error('Error al agregar el producto al carrito:', error);
        res.render('cart', { error: 'Error al agregar el producto al carrito.' });
    }
});

/// Realizar la compra
app.post('/purchase', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        // Obtener los productos del carrito junto con store_id
        const cartItems = await sql`
            SELECT 
                p.id AS product_id, 
                p.price, 
                p.store_id, 
                c.quantity 
            FROM cart c
            JOIN products p ON c.product_id = p.id 
            WHERE c.user_id = ${userId}
        `;

        // Calcular el total de la compra
        const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // Verificar si el usuario tiene suficiente dinero en la wallet
        const userResult = await sql`
            SELECT wallet 
            FROM users 
            WHERE id = ${userId}
        `;
        const wallet = userResult[0]?.wallet || 0;

        if (parseFloat(wallet) < total) {
            return res.render('cart', { error: 'Fondos insuficientes para realizar la compra.', cart: cartItems, total });
        }

        // Actualizar la wallet del usuario
        await sql`
            UPDATE users 
            SET wallet = wallet - ${total} 
            WHERE id = ${userId}
        `;

        // Registrar cada producto comprado en la tabla `sales`
        for (const item of cartItems) {
            await sql`
                INSERT INTO sales (user_id, product_id, quantity, order_date, store_id) 
                VALUES (${userId}, ${item.product_id}, ${item.quantity}, NOW(), ${item.store_id})
            `;

            // Reducir el stock de los productos comprados
            await sql`
                UPDATE products 
                SET stock = stock - ${item.quantity} 
                WHERE id = ${item.product_id}
            `;
        }

        // Generar un recibo
        await sql`
            INSERT INTO receipts (user_id, amount) 
            VALUES (${userId}, ${total})
        `;

        // Vaciar el carrito
        await sql`
            DELETE FROM cart 
            WHERE user_id = ${userId}
        `;

        res.redirect('/cart?success=Compra realizada con éxito');
    } catch (error) {
        console.error('Error al realizar la compra:', error);
        res.render('cart', { error: 'Error al realizar la compra.' });
    }
});

// CREAR, EDITAR Y ELIMINAR 
app.get('/create-product', authenticateToken, checkAdmin, (req, res) => {
    res.render('create-product'); 
});

// Ruta para crear un producto
app.post('/create-product', authenticateToken, checkAdmin, async (req, res) => {
    const { title, price, stock, img } = req.body;

    // Validar datos de entrada
    if (!title || !price || !stock || !img) {
        return res.render('create-product', { error: 'Todos los campos son obligatorios.', formData: req.body });
    }

    try {
        await sql`
            INSERT INTO products (title, price, stock, img)
            VALUES (${title}, ${price}, ${stock}, ${img})
        `;
        res.redirect('/admin');
    } catch (error) {
        console.error('Error al crear el producto:', error);
        res.render('create-product', { error: 'Error al crear el producto. Inténtalo nuevamente.', formData: req.body });
    }
});

// Ruta para mostrar el formulario de editar producto
app.get('/edit-product/:id', authenticateToken, checkAdmin, async (req, res) => {
    const productId = req.params.id;

    try {
        const result = await sql`
            SELECT id, title, price, stock, img FROM products WHERE id = ${productId}
        `;
        const product = result[0];

        if (!product) {
            return res.redirect('/admin?error=Producto no encontrado.');
        }

        res.render('edit-product', { product }); 
    } catch (error) {
        console.error('Error al obtener el producto:', error);
        res.redirect('/admin?error=Error al obtener los datos del producto.');
    }
});

// Ruta para actualizar un producto
app.post('/edit-product/:id', authenticateToken, checkAdmin, async (req, res) => {
    const productId = req.params.id;
    const { title, price, stock, img } = req.body;

    // Validar datos de entrada
    if (!title || !price || !stock || !img) {
        return res.render('edit-product', { error: 'Todos los campos son obligatorios.', product: { id: productId, title, price, stock, img } });
    }

    try {
        await sql`
            UPDATE products
            SET title = ${title}, price = ${price}, stock = ${stock}, img = ${img}
            WHERE id = ${productId}
        `;
        res.redirect('/admin');
    } catch (error) {
        console.error('Error al actualizar el producto:', error);
        res.render('edit-product', { error: 'Error al actualizar el producto. Inténtalo nuevamente.', product: { id: productId, title, price, stock, img } });
    }
});

// Ruta para eliminar un producto
app.post('/delete-product/:id', authenticateToken, checkAdmin, async (req, res) => {
    const productId = req.params.id;

    try {
        await sql`
            DELETE FROM products WHERE id = ${productId}
        `;
        res.redirect('/admin');
    } catch (error) {
        console.error('Error al eliminar el producto:', error);
        res.redirect('/admin?error=Error al eliminar el producto.');
    }
});

// DEVOLUCION 
app.get('/purchases', authenticateToken, async (req, res) => {
    try {
        const purchases = await sql`
            SELECT s.id AS sale_id, p.title, s.quantity, s.order_date
            FROM sales s
            JOIN products p ON s.product_id = p.id
            WHERE s.user_id = ${req.user.id}
        `;
        res.render('purchases', { purchases });
    } catch (error) {
        console.error('Error al cargar las compras:', error);
        res.render('purchases', { error: 'Error al cargar las compras.' });
    }
});

app.post('/return-product/:saleId', authenticateToken, async (req, res) => {
    const saleId = req.params.saleId;
    try {
        // Lógica para procesar la devolución
        const sale = await sql`
            SELECT * FROM sales WHERE id = ${saleId} AND user_id = ${req.user.id}
        `;

        if (sale.length === 0) {
            return res.render('purchases', { error: 'No se encontró la venta.' });
        }

        const productId = sale[0].product_id;
        const quantity = sale[0].quantity;

        const result = await sql`
            SELECT MAX(id) AS max_id FROM returns
        `;

        let newId = result[0]?.max_id || 0;
        newId += 1; 

        await sql`
            INSERT INTO returns (id, user_id, product_id, quantity, return_date)
            VALUES (${newId}, ${req.user.id}, ${productId}, ${quantity}, NOW())
        `;

    
        await sql`
            UPDATE products
            SET stock = stock + ${quantity}
            WHERE id = ${productId}
        `;

        await sql`
            DELETE FROM sales WHERE id = ${saleId}
        `;

        res.redirect('/purchases?success=Producto devuelto con éxito.');
    } catch (error) {
        console.error('Error al devolver el producto:', error);
        res.render('purchases', { error: 'Error al procesar la devolución.' });
    }
});

// Obtener los 3 productos más baratos
app.get('/cheapest-products', async (req, res) => {
    try {
        const cheapestProducts = await sql`
            SELECT id, title, price
            FROM products
            ORDER BY price ASC
            LIMIT 3;
        `;

        // Renderizar la vista con los productos
        res.render('cheapest-products', { cheapestProducts });
    } catch (error) {
        console.error('Error al obtener los productos más baratos:', error);
        res.render('cheapest-products', { error: 'Error al cargar los productos más baratos.' });
    }
});



app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});