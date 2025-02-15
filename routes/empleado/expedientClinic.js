const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el historial médico de un paciente por su ID
router.get("/paciente/:id", async (req, res) => {
    const { id } = req.params;
    try {
        // Obtener el historial médico del paciente usando la clave foránea paciente_id
        const historialQuery = "SELECT * FROM historial_medico WHERE paciente_id = ?";
        const [historial] = await db.query(historialQuery, [id]);
        console.log("Historial médico:", historial); // Verifica la respuesta completa

        if (!historial.length) {
            return res.status(404).json({ message: "No se encontró historial médico para este paciente" });
        }

        // Retornar solo los datos del historial médico
        res.json({
            historial
        });
    } catch (error) {
        console.error("Error obteniendo el historial médico:", error);
        res.status(500).json({ message: "Error en el servidor" });
    }
});

module.exports = router;
