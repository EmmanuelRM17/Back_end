const express = require('express');
const db = require('../../../db'); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Ruta para obtener los eventos del calendario (agenda)
router.get('/agenda', (req, res) => {
  const sql = `
    SELECT
      c.fecha_consulta,    -- Fecha de la consulta
      s.duration,          -- Duración del servicio en minutos
      c.servicio_nombre    -- Nombre del servicio
    FROM citas c
    JOIN servicios s ON c.servicio_id = s.id;
  `;

  // Ejecutar la consulta SQL
  db.query(sql, (err, result) => {
    if (err) {
      console.error('Error al obtener los eventos:', err); // Log para ver el error
      return res.status(500).json({ message: 'Hubo un problema al obtener los eventos' });
    }

    // Verificar si no hay resultados
    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'No se encontraron eventos' });
    }

    // Devolver los resultados en formato JSON
    res.status(200).json(result);
  });
});

module.exports = router;
