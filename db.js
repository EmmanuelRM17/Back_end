const mysql = require('mysql2/promise');
require('dotenv').config(); // Cargar variables de entorno

// Configuración para ambos entornos
const isLocalhost = false; // Cambia a true para usar base de datos local

const config = isLocalhost
  ? {
      // Configuración local
      host: 'localhost',
      user: 'root', // o tu usuario local
      password: '', // tu contraseña local
      database: 'db_carol', // nombre de tu base de datos local
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
}).promise(); 

// Verificar la conexión al crear el pool
pool.getConnection((err, connection) => {
  if (err) {
    console.error('Error conectando a la base de datos:', err.message);
    return;
  }
  console.log('Conexión a MySQL exitosa');
  console.log('Conectado a la base de datos en:', config.host);
  connection.release();
});

module.exports = pool;
