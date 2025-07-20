const express = require("express");
const router = express.Router();
const db = require("../../db");
const xss = require("xss");
const moment = require("moment-timezone");
const logger = require('../../utils/logger');


// Ruta POST: /loginalexa
router.post("/loginalexa", (req, res) => {
  const telefono = xss(req.body.telefono); // sanitiza input

  if (!telefono) {
    return res.status(400).json({ message: "Proporciona un número de teléfono." });
  }

  const sql = "SELECT * FROM pacientes WHERE telefono = ?";
  db.query(sql, [telefono], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Error del servidor." });
    }

    if (result.length === 0) {
      return res.status(404).json({ message: "Teléfono no registrado." });
    }

    const paciente = result[0];

    return res.status(200).json({
      message: "Inicio de sesión exitoso",
      user: {
        id: paciente.id,
        nombre: paciente.nombre,
        telefono: paciente.telefono,
        email: paciente.email
      }
    });
  });
});


router.post("/agendarcita", async (req, res) => {
  const {
    paciente_id,
    nombre,
    servicio_id,
    servicio_nombre,
    precio_servicio,
    fecha_consulta
  } = req.body;

  // Validar campos obligatorios
  if (!paciente_id || !nombre || !servicio_id || !servicio_nombre || !precio_servicio || !fecha_consulta) {
    return res.status(400).json({ message: "Faltan datos requeridos." });
  }

  // Validar formato de fecha: YYYY-MM-DD HH:mm:ss
  const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!dateRegex.test(fecha_consulta)) {
    return res.status(400).json({ message: "Formato de fecha inválido. Usa YYYY-MM-DD HH:MM:SS." });
  }

  try {
    // Sanitizar entradas
    const sanitizedNombre = xss(nombre);
    const sanitizedServicioNombre = xss(servicio_nombre);
    const sanitizedFecha = xss(fecha_consulta);

    const insertSql = `
      INSERT INTO citas (paciente_id, nombre, servicio_id, servicio_nombre, precio_servicio, fecha_consulta)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(insertSql, [
      paciente_id,
      sanitizedNombre,
      servicio_id,
      sanitizedServicioNombre,
      precio_servicio,
      sanitizedFecha
    ], (err, result) => {
      if (err) {
        console.error("Error al agendar cita:", err.sqlMessage);
        return res.status(500).json({ message: "Error al agendar la cita.", error: err.sqlMessage });
      }

      res.status(201).json({ message: "Cita agendada exitosamente.", cita_id: result.insertId });
    });

  } catch (error) {
    console.error("Error en servidor:", error);
    res.status(500).json({ message: "Error del servidor." });
  }
});



module.exports = router;
