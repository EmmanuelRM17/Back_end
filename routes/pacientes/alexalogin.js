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



// POST /api/paciente/agendarcita
router.post("/agendarcita", async (req, res) => {
  try {
    const { paciente_id, nombre, servicio, precio, fecha_de_cita } = req.body;

    if (!paciente_id || !nombre || !servicio || !precio || !fecha_de_cita) {
      return res.status(400).json({ message: "Todos los campos son requeridos." });
    }

    // Sanitizar entradas
    const safeNombre = xss(nombre);
    const safeServicio = xss(servicio);
    const safeFecha = xss(fecha_de_cita);

    // Validar que la fecha sea válida y futura
    const fechaMoment = moment.tz(safeFecha, "America/Mexico_City");
    if (!fechaMoment.isValid()) {
      return res.status(400).json({ message: "La fecha proporcionada no es válida." });
    }
    if (fechaMoment.isBefore(moment.tz("America/Mexico_City"))) {
      return res.status(400).json({ message: "La fecha de la cita debe ser futura." });
    }

    // Verificar existencia del paciente
    const [pacienteRows] = await db.promise().query("SELECT * FROM paciente WHERE id = ?", [paciente_id]);
    if (pacienteRows.length === 0) {
      return res.status(404).json({ message: "Paciente no encontrado." });
    }

    const odontologo_id = 3;
    const odontologo_nombre = "Hugo Gómez Ramírez";

    // Validar que el horario esté libre para el odontólogo 3
    const [citasOcupadas] = await db.promise().query(
      `SELECT COUNT(*) AS count FROM citasAlexa 
       WHERE fecha_de_cita = ? AND odontologo_id = ?`,
      [safeFecha, odontologo_id]
    );

    if (citasOcupadas[0].count > 0) {
      return res.status(400).json({
        message: `El horario ${safeFecha} no está disponible para el odontólogo ${odontologo_nombre}.`
      });
    }

    // Insertar la cita con odontólogo fijo
    const insertSQL = `
      INSERT INTO citasAlexa (paciente_id, nombre, servicio, precio, fecha_de_cita, odontologo_id, odontologo_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.promise().query(insertSQL, [
      paciente_id,
      safeNombre,
      safeServicio,
      precio,
      safeFecha,
      odontologo_id,
      odontologo_nombre,
    ]);

    res.status(201).json({
      message: "Cita agendada exitosamente.",
      cita: {
        id: result.insertId,
        paciente_id,
        nombre: safeNombre,
        servicio: safeServicio,
        precio,
        fecha_de_cita: safeFecha,
        odontologo_id,
        odontologo_nombre
      }
    });

  } catch (error) {
    console.error("Error en /agendarcita:", error);
    res.status(500).json({ message: "Error en el servidor." });
  }
});
module.exports = router;
