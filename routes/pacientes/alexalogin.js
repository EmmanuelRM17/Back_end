const express = require("express");
const router = express.Router();
const db = require("../../db");
const xss = require("xss");

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

// Nueva ruta POST: /agendarcita
router.post("/agendarcita", (req, res) => {
  const { paciente_id, nombre, servicio, precio, fecha_de_cita } = req.body;

  // Validar los datos recibidos
  if (!paciente_id || !nombre || !servicio || !precio || !fecha_de_cita) {
    return res.status(400).json({ message: "Todos los campos son requeridos." });
  }

  // Sanitizar los inputs
  const sanitizedNombre = xss(nombre);
  const sanitizedServicio = xss(servicio);
  const sanitizedFecha = xss(fecha_de_cita);

  // Validar formato de fecha (puede ajustarse según necesidades)
  const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!dateRegex.test(sanitizedFecha)) {
    return res.status(400).json({ message: "Formato de fecha inválido. Usa YYYY-MM-DD HH:MM:SS." });
  }

  // Validar que el paciente_id existe (opcional, dependiendo de tu lógica)
  const checkPatientSql = "SELECT id FROM pacientes WHERE id = ?";
  db.query(checkPatientSql, [paciente_id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Error del servidor." });
    }
    if (result.length === 0) {
      return res.status(404).json({ message: "Paciente no encontrado." });
    }

    // Insertar la cita en la base de datos
    const insertSql = "INSERT INTO citasAlexa (paciente_id, nombre, servicio, precio, fecha_de_cita) VALUES (?, ?, ?, ?, ?)";
    db.query(insertSql, [paciente_id, sanitizedNombre, sanitizedServicio, precio, sanitizedFecha], (err, result) => {
      if (err) {
        console.error("Error al agendar cita:", err);
        return res.status(500).json({ message: "Error al agendar la cita." });
      }

      return res.status(201).json({
        message: "Cita agendada exitosamente.",
        cita: {
          id: result.insertId,
          paciente_id,
          nombre: sanitizedNombre,
          servicio: sanitizedServicio,
          precio,
          fecha_de_cita: sanitizedFecha
        }
      });
    });
  });
});

module.exports = router;
