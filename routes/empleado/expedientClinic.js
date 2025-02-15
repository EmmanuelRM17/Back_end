const express = require("express");
const router = express.Router();
const db = require("../../db");

// Obtener el historial médico de un paciente por su ID
router.get("/:paciente_id", async (req, res) => {
    try {
        const { paciente_id } = req.params;

        if (!paciente_id) {
            return res.status(400).json({ message: "El ID del paciente es requerido." });
        }

        // Query para obtener el historial médico, citas y servicios
        const query = `
            SELECT 
                hm.id, 
                hm.paciente_id, 
                hm.cita_id, 
                hm.fecha_registro, 
                hm.enfermedades_previas, 
                hm.tratamientos_recientes,
                c.fecha_hora,
                c.estado,
                c.notas,
                s.title AS servicio_title,
                s.description AS servicio_description,
                s.duration AS servicio_duration,
                s.price AS servicio_price
            FROM historial_medico hm
            LEFT JOIN citas c ON hm.cita_id = c.id
            LEFT JOIN servicios s ON c.servicio_id = s.id
            WHERE hm.paciente_id = ?
        `;

        db.query(query, [paciente_id], (err, results) => {
            if (err) {
                console.error("Error al obtener el historial médico:", err);
                return res.status(500).json({ message: "Error en el servidor." });
            }

            if (results.length === 0) {
                return res.status(404).json({ message: "Historial médico no encontrado." });
            }

            return res.json(results); // Devuelve el historial médico con datos de citas y servicios
        });
    } catch (error) {
        console.error("Error en /historial/:paciente_id:", error);
        res.status(500).json({ message: "Error en el servidor." });
    }
});

module.exports = router;
