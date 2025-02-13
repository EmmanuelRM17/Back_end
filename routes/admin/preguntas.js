const express = require("express");
const router = express.Router();
const db = require("../db");
const xss = require("xss");
const logger = require("../utils/logger");

// Verificar si el correo está registrado
router.post("/verificar-correo", async (req, res) => {
  const email = xss(req.body.email);

  if (!email) return res.status(400).json({ message: "El correo es requerido." });

  try {
    const query = "SELECT id AS paciente_id, nombre FROM pacientes WHERE email = ?";
    const [rows] = await db.promise().query(query, [email]);

    if (rows.length > 0) {
      return res.json({ exists: true, name: rows[0].nombre, paciente_id: rows[0].paciente_id });
    } else {
      return res.json({ exists: false });
    }
  } catch (error) {
    logger.error(`Error al verificar el correo: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

// ✅ 2️⃣ Obtener todas las preguntas frecuentes
router.get("/get-all", async (req, res) => {
  try {
    const query = "SELECT id, pregunta AS question, respuesta AS answer FROM preguntas_frecuentes ORDER BY fecha_creacion DESC";
    const [rows] = await db.promise().query(query);

    res.json(rows);
  } catch (error) {
    logger.error(`Error al obtener preguntas frecuentes: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

// ✅ 3️⃣ Agregar una nueva pregunta
router.post("/nueva", async (req, res) => {
  const { email, name, question, paciente_id } = req.body;

  if (!email || !name || !question) {
    return res.status(400).json({ message: "Todos los campos son obligatorios." });
  }

  try {
    const insertQuery = `
      INSERT INTO preguntas_frecuentes (pregunta, respuesta, fecha_creacion, paciente_id, estado)
      VALUES (?, 'Pendiente de respuesta', NOW(), ?, ?)
    `;
    await db.promise().query(insertQuery, [question, paciente_id || null, paciente_id ? "registrado" : "no_registrado"]);

    res.status(201).json({ message: "Pregunta agregada correctamente." });
  } catch (error) {
    logger.error(`Error al agregar la pregunta: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

// ✅ 4️⃣ Responder una pregunta (solo administradores o empleados)
router.put("/responder/:id", async (req, res) => {
  const { respuesta } = req.body;
  const { id } = req.params;

  if (!respuesta) {
    return res.status(400).json({ message: "La respuesta no puede estar vacía." });
  }

  try {
    const updateQuery = "UPDATE preguntas_frecuentes SET respuesta = ?, estado = 'respondida' WHERE id = ?";
    const [result] = await db.promise().query(updateQuery, [respuesta, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Pregunta no encontrada." });
    }

    res.status(200).json({ message: "Pregunta respondida correctamente." });
  } catch (error) {
    logger.error(`Error al responder la pregunta: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

// ✅ 5️⃣ Eliminar una pregunta (solo administradores)
router.delete("/eliminar/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deleteQuery = "DELETE FROM preguntas_frecuentes WHERE id = ?";
    const [result] = await db.promise().query(deleteQuery, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Pregunta no encontrada." });
    }

    res.status(200).json({ message: "Pregunta eliminada correctamente." });
  } catch (error) {
    logger.error(`Error al eliminar la pregunta: ${error.message}`);
    res.status(500).json({ message: "Error del servidor." });
  }
});

module.exports = router;
