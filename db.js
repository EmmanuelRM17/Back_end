const mysql = require('mysql2');

// Configuración para ambos entornos
const isLocalhost = true; // Cambia a true para usar base de datos local

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
      // Configuración de producción (la que tenías)
      host: '193.203.166.102',
      user: 'u666156220_carol',
      password: '20221058Emma',
      database: 'u666156220_db_carol',
      port: 3306,
    };

// Crear un pool de conexiones a MySQL
const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

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