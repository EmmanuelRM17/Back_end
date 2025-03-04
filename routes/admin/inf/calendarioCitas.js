const express = require('express');
const db = require('../../../db'); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Ruta para obtener los datos de la agenda
router.get('/agenda', (req, res) => {
    const sql = `
      SELECT
        c.id AS cita_id,
        c.fecha_consulta,    -- Fecha de la consulta
        s.duration,          -- Duración del servicio en minutos
        c.servicio_nombre    -- Nombre del servicio
      FROM citas c
      JOIN servicios s ON c.servicio_id = s.id;
    `;
    db.query(sql, (err, result) => {
      if (err) {
        return res.status(500).json({ message: 'Error al obtener la agenda de citas.' });
      }
      res.status(200).json(result);
    });
  });

  // Ruta para obtener los detalles completos de una cita específica
router.get("/agenda/:id", (req, res) => {
  const citaId = req.params.id;

  // Verificar que el ID de la cita es válido (solo números)
  if (!/^\d+$/.test(citaId)) {
    return res.status(400).json({ message: "ID de cita inválido" });
  }

  const sql = `
   SELECT
      -- Datos de la cita
      c.id AS cita_id,
      c.fecha_consulta,
      c.estado,

      -- Datos del servicio
      s.id AS servicio_id,
      s.title AS servicio_nombre,
      s.category AS categoria_servicio,
      s.price AS precio_servicio,
      s.duration AS duracion_servicio,

      -- Datos del paciente desde la tabla citas
      c.paciente_id,
      c.nombre,
      c.apellido_paterno,
      c.apellido_materno,
      c.genero,
      c.fecha_nacimiento,
      c.telefono,
      c.correo AS email
      
    FROM citas c
    JOIN servicios s ON c.servicio_id = s.id
    WHERE c.id = ?;
  `;

  db.query(sql, [citaId], (err, result) => {
    if (err) {
      console.error("Error en la consulta SQL:", err);
      return res.status(500).json({ message: "Error al obtener los detalles de la cita." });
    }
    if (result.length === 0) {
      return res.status(404).json({ message: "Cita no encontrada." });
    }
    res.status(200).json(result[0]);
  });
});


module.exports = router;



