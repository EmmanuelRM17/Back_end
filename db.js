const mysql = require('mysql2');
require('dotenv').config();

// Configuración para ambos entornos
const isLocalhost = false; 

const config = isLocalhost
  ? {
      // Configuración local
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'db_carol',
      port: 3306,
    }
  : {
      // Configuración de producción (Hostinger)
      host: '191.96.56.204',
      user: 'u478151766_carol',
      password: 'Fh3aKXw0Yu|',
      database: 'u478151766_Odontology',
      port: 3306,
    };

// Crear un pool de conexiones a MySQL
const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise(); // AÑADE ESTA LÍNEA - Convierte el pool a promesas

// Verificar la conexión al crear el pool
pool.getConnection()
  .then(connection => {
    console.log('Conexión a MySQL exitosa');
    console.log('Conectado a la base de datos en:', config.host);
    connection.release();
  })
  .catch(err => {
    console.error('Error conectando a la base de datos:', err.message);
  });

module.exports = pool;