const express = require('express');
const db = require('../../../db'); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Ruta para obtener los eventos del calendario
router.get('/agenda', async (req, res) => {
  try {
    // Consulta SQL ajustada para obtener fecha de consulta, duración y nombre del servicio
    const query = `
      SELECT
        c.fecha_consulta,    -- Fecha de la consulta
        s.duration,          -- Duración del servicio en minutos
        c.servicio_nombre    -- Nombre del servicio
      FROM citas c
      JOIN servicios s ON c.servicio_id = s.id;
    `;
    const result = await db.query(query);

    // Log para ver el resultado de la consulta
    console.log('Resultado de la consulta:', result.rows);

    // Si la consulta no devuelve datos
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron eventos' });
    }

    // Enviar los datos tal como están (sin procesarlos para calendario)
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener los eventos:', error);
    res.status(500).json({ error: 'Hubo un problema al obtener los eventos' });
  }
});

module.exports = router;
