const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const helmet = require('helmet');

const https = require('https');
const fs = require('fs');

// Certificados SSL
const privateKey = fs.readFileSync('C:/xampp/apache/conf/ssl.key/server.key', 'utf8'); // Ruta al archivo .key
const certificate = fs.readFileSync('C:/xampp/apache/conf/ssl.crt/server.crt', 'utf8'); // Ruta al archivo .crt
const credentials = { key: privateKey, cert: certificate }; // Agrupación de las credenciales


// Configurar las políticas de seguridad de contenido (CSP) con Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
        frameSrc: ["'self'", "https://www.google.com", "https://www.recaptcha.net"],
        imgSrc: ["'self'", "https://www.google.com", "https://www.gstatic.com"],
      },
    },
  })
);

// Configuración de CORS para permitir solicitudes desde ambos dominios de frontend
app.use(cors({
  origin: ['https://odontologiacarol.onrender.com', 'https://odontologiacarol.isoftuthh.com', 'https://localhost:4000', 'https://localhost', 'https://localhost/carol'], // Dominios permitidos
  credentials: true  // Permitir el envío de cookies y credenciales
}));

// Configuración de middlewares
app.use(bodyParser.json());
app.use(express.json());

// Importar las rutas
const userRoutes = require('./routes/userRoutes');
const Registrer = require('./routes/registrer');
const politicasRoutes = require('./routes/politicasRoutes.js');
const deslindeRoutes = require('./routes/deslindelegal.js');
const terminosRoutes = require('./routes/terminosYcondicion.js');
const perfil_empresa = require('./routes/perfilEmpresa.js');
const reportes = require('./routes/reportes.js')
const redes = require('./routes/redessociales.js');

// Asignar las rutas a la aplicación
app.use('/api', Registrer);
app.use('/api/users', userRoutes); 
app.use('/api/politicas', politicasRoutes);
app.use('/api/deslinde', deslindeRoutes); 
app.use('/api/termiCondicion', terminosRoutes); 
app.use('/api/perfilEmpresa', perfil_empresa);
app.use('/api/reportes', reportes);
app.use('/api/redesSociales', redes);

app.get('/api/get-csrf-token', (req, res) => {
  res.json({ csrfToken: 'token-generado-de-prueba' });
});

const PORT = process.env.PORT || 3001;

https.createServer(credentials, app).listen(PORT, () => {
  console.log(`Servidor corriendo con HTTPS en el puerto ${PORT}`);
});
