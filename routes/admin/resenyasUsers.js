const express = require('express');
const router = express.Router();
const db = require('../../db'); // Importa tu módulo de conexión a la BD

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

router.put('/estado/:id', (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  // Validar que el estado solo sea "Habilitado" o "Deshabilitado"
  if (!['Habilitado', 'Deshabilitado'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido. Valores permitidos: Habilitado o Deshabilitado' });
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

router.delete('/eliminar/:id', (req, res) => {
  const { id } = req.params;

  console.log(`Intentando eliminar reseña con ID: ${id}`);

  const query = `DELETE FROM resenyas WHERE id = ?`;

  db.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error al eliminar la reseña:", err);
      return res.status(500).json({ error: "Error interno del servidor", details: err.message });
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


module.exports = router;
