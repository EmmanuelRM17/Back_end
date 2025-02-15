const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el historial médico de un paciente por su ID
router.get("/paciente/:id", async (req, res) => {
    const { id } = req.params;  // Obtener el ID del paciente desde los parámetros de la URL
    try {
        // Obtener los datos del historial médico del paciente, usando el paciente_id como clave foránea
        const historialQuery = `
            SELECT 
                hm.id, 
                hm.paciente_id, 
                hm.cita_id, 
                hm.fecha_registro, 
                hm.enfermedades_previas, 
                hm.tratamientos_recientes
            FROM historial_medico hm
            WHERE hm.paciente_id = ?
        `;
        
        const [historial] = await db.query(historialQuery, [id]);

        if (!historial.length) {
            return res.status(404).json({ message: "Historial médico no encontrado para este paciente" });
        }

        // Retornar los datos del historial médico
        res.json({
            historial
        });
    } catch (error) {
        console.error("Error obteniendo el historial médico:", error);
        res.status(500).json({ message: "Error en el servidor" });
    }
});

module.exports = router;
