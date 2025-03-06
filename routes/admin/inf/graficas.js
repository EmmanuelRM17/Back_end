const express = require("express");
const db = require("../../../db"); // Ruta correcta a tu conexión de base de datos
const router = express.Router();

// Endpoint para obtener los tratamientos más realizados
router.get("/topservicios", async (req, res) => {
  try {
    const query = `
      SELECT servicio_nombre, COUNT(*) AS total_realizados
      FROM citas
      GROUP BY servicio_nombre
      ORDER BY total_realizados DESC;
    `;

    db.query(query, (err, results) => {
      if (err) {
        console.error("Error al obtener tratamientos:", err);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
      res.json(results);
    });
  } catch (error) {
    console.error("Error en la consulta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = router;
