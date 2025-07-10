const express = require("express");
const router = express.Router();
const db = require("../../db"); // Importa tu módulo de conexión a la BD

router.get("/get", async (req, res) => {
  try {
    const query = `
      SELECT 
         r.id AS reseñaId,
         r.comentario,
         r.calificacion,
         r.estado,
         r.fecha_creacion,
         p.id AS pacienteId,
         p.nombre,
         p.aPaterno,
         p.aMaterno
      FROM resenyas r
      JOIN pacientes p ON r.paciente_id = p.id
      ORDER BY r.fecha_creacion DESC;
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error al obtener las reseñas:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

router.put("/estado/:id", (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  // Validar que el estado solo sea "Habilitado" o "Deshabilitado"
  if (!["Habilitado", "Deshabilitado"].includes(estado)) {
    return res
      .status(400)
      .json({
        error:
          "Estado inválido. Valores permitidos: Habilitado o Deshabilitado",
      });
  }

  const query = `
    UPDATE resenyas 
    SET estado = ? 
    WHERE id = ?;
  `;

  db.query(query, [estado, id], (err, result) => {
    if (err) {
      console.error("Error al actualizar el estado:", err);
      return res.status(500).json({ error: "Error interno del servidor" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Reseña no encontrada" });
    }

    res.status(200).json({ message: `Reseña actualizada a ${estado}` });
  });
});

router.delete("/eliminar/:id", (req, res) => {
  const { id } = req.params;

  console.log(`Intentando eliminar reseña con ID: ${id}`);

  const query = `DELETE FROM resenyas WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar la reseña:", err);
      return res
        .status(500)
        .json({ error: "Error interno del servidor", details: err.message });
    }

    console.log("Resultado de la consulta:", result);

    if (!result || result.affectedRows === 0) {
      console.warn("⚠️ No se encontró la reseña para eliminar.");
      return res.status(404).json({ error: "Reseña no encontrada" });
    }

    console.log("Reseña eliminada con éxito.");
    return res.status(200).json({ message: "Reseña eliminada correctamente" });
  });
});

router.post("/crear", async (req, res) => {
  const { paciente_id, cita_id, comentario, calificacion } = req.body;

  // Validaciones básicas
  if (!paciente_id || !cita_id || !comentario || !calificacion) {
    return res.status(400).json({
      error:
        "Los campos paciente_id, cita_id, comentario y calificacion son obligatorios",
    });
  }

  if (calificacion < 1 || calificacion > 5) {
    return res.status(400).json({
      error: "La calificación debe estar entre 1 y 5",
    });
  }

  if (comentario.trim().length < 10) {
    return res.status(400).json({
      error: "El comentario debe tener al menos 10 caracteres",
    });
  }

  try {
    // Verificar que la cita existe, pertenece al paciente Y está completada
    const checkCitaQuery = `
      SELECT c.id, c.servicio_id, c.estado 
      FROM citas c 
      WHERE c.id = ? AND c.paciente_id = ?
    `;

    db.query(checkCitaQuery, [cita_id, paciente_id], (err, citaResult) => {
      if (err) {
        console.error("Error al verificar cita:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }

      if (citaResult.length === 0) {
        return res.status(404).json({
          error: "Cita no encontrada o no pertenece a este paciente",
        });
      }

      const cita = citaResult[0];

      // VALIDAR QUE LA CITA ESTÉ COMPLETADA
      if (cita.estado !== "Completada") {
        return res.status(400).json({
          error: "Solo puedes reseñar citas que ya han sido completadas",
        });
      }

      // Verificar si ya existe una reseña para esta cita
      const checkExistingQuery = "SELECT id FROM resenyas WHERE cita_id = ?";

      db.query(checkExistingQuery, [cita_id], (err, existingResult) => {
        if (err) {
          console.error("Error al verificar reseña existente:", err);
          return res.status(500).json({ error: "Error interno del servidor" });
        }

        if (existingResult.length > 0) {
          return res.status(400).json({
            error: "Ya has enviado una reseña para esta cita",
          });
        }

        // Crear la reseña con TODOS los campos
        const insertQuery = `
          INSERT INTO resenyas (
            paciente_id, 
            cita_id,
            servicio_id,
            comentario, 
            calificacion, 
            estado, 
            fecha_creacion
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;

        const values = [
          paciente_id,
          cita_id,
          cita.servicio_id, // Obtenido de la cita
          comentario.trim(),
          calificacion,
          "Pendiente", // Estado inicial para moderación
        ];

        db.query(insertQuery, values, (err, result) => {
          if (err) {
            console.error("Error al crear la reseña:", err);
            return res
              .status(500)
              .json({ error: "Error interno del servidor" });
          }

          console.log("Reseña creada exitosamente. ID:", result.insertId);

          res.status(201).json({
            message:
              "Reseña enviada exitosamente. Será revisada antes de publicarse.",
            resenya_id: result.insertId,
            estado: "Pendiente",
          });
        });
      });
    });
  } catch (error) {
    console.error("Error en la creación de reseña:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
router.get("/verificar/:paciente_id/:cita_id", async (req, res) => {
  const { paciente_id, cita_id } = req.params;

  try {
    const query =
      "SELECT id FROM resenyas WHERE paciente_id = ? AND cita_id = ?";

    db.query(query, [paciente_id, cita_id], (err, result) => {
      if (err) {
        console.error("Error al verificar reseña:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }

      res.json({
        ya_reseno: result.length > 0,
        resenya_id: result.length > 0 ? result[0].id : null,
      });
    });
  } catch (error) {
    console.error("Error en la verificación:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
module.exports = router;
