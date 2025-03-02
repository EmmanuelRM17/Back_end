const express = require('express');
const db = require('../../../db'); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Ruta para obtener los datos de la agenda
router.get('/agenda', async (req, res) => {
  try {
    // Consulta SQL para obtener los datos tal como están
    const query = `
      SELECT
        c.fecha_consulta,    -- Fecha de la consulta
        s.duration,          -- Duración del servicio en minutos
        c.servicio_nombre    -- Nombre del servicio
      FROM citas c
      JOIN servicios s ON c.servicio_id = s.id;
    `;
    
    const result = await db.query(query); // Ejecutamos la consulta

    // Si la consulta no devuelve datos
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron eventos' });
    }

    // Enviar los datos tal como están en formato JSON
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener los eventos:', error);
    res.status(500).json({ error: 'Hubo un problema al obtener los eventos' });
  }
});

module.exports = router;
